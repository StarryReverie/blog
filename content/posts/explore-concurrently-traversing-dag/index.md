---
title: 探索并发遍历 DAG
date: 2026-09-23T21:16:00+08:00
draft: false
categories: Tech
tags:
  - Haskell
  - Nix
  - Algorithm
  - Concurrency
math: false
---

探索如何编写一个更简洁和优雅的并发 DAG 遍历算法。

<!-- more -->

## 背景

最近我有了新的 Idea，想要分析一个 Nix Derivation 的依赖图，并以树形结构打印。在这个图结构中，不是所有的 Derivation 或 Store Object 都会被打印，而是只有那些没有被构建或还没有从缓存服务器上同步的才会被显示。也就是说，分析出某 Store Object 的闭包中在本机上还不存在的部分。这个项目已经基本上完成，名为 [DrvGraph](https://github.com/StarryReverie/DrvGraph)。

在 DrvGraph 中，最核心的部分自然是对于 Nix Store 进行遍历，分析其中的 Derivation 和 Store Object 的连接关系。由于需要查询某些 Store Object 是否存在与缓存上，网络 IO 成为了遍历过程中的瓶颈，所以我们需要一个并发的遍历实现。

串行的有向无环图遍历算法非常简单，几乎是算法课的最基础部分。然而这样一种朴素的实现却难以迁移到并发环境下。本文则尝试探索更好的并发版本的 DAG 遍历。

## 基本概念

在讨论遍历算法实现之前，首先我们需要了解一下 DrvGraph 场景下 DAG 的组成。

DrvGraph 分析的是 Derivation 或 Store Object 之间的依赖关系，这也就是说 DAG 中存在这两种节点 Derivation 和 Store Object。这是由于 Nix 既是一个包管理器又是一个构建系统，Derivation 是一个包的构建过程的描述，Store Object 是构建的输入或产物。

### Derivation

在 Nix 中，一个包实际上对于一个 Derivation，它存储于 Nix Store 中，路径包括内容的哈希、包名，并以 `.drv` 结尾。比如 `g1w7hy3qg1w7hy3qg1w7hy3qg1w7hy3q-foo.drv` 就是一个可能的 Derivation 的文件的路径，称为 Deriving Path。Deriving Path 可以看作是 Derivation 的唯一标识。

以下是 Deriving Path 在 DrvGraph 中的表示：

```haskell
-- | Path to a derivation file in the Nix store, without the store directory.
data DerivingPath = DerivingPath
    { hash :: Nix32Hash
    , name :: Text
    }
    deriving (Eq, Ord, Show)
```

Derivation 作为一个构建过程描述，包括了需要运行的命令、构建的依赖、最终的产出以及其他的元信息。Derivation 文件的内容是比较底层的表示，它是由 Nix 包管理器/构建系统通过求值 Nix 语言转换得到的，所以包括了一些 Nix 源语言中没有直接表示的信息，比如各种计算出来的哈希值和路径。在 DrvGraph 中，我们更关注的是 Derivation 的输入和输出。

Derivation 的输入包括两种，一种是在求值阶段就已知的文件，在代码中称为 `inputSrcs`，另一种是其他 Derivation 构建的产出，在代码中称为 `inputDrvs`。Derivation 的输出称为 `outputs`，其可以有多个输出，每一个输出都是一个 Store Object，通过 Output Name 区分。所以一个 Deriving Path 和 Output Name 的组合唯一确定了一个 Store Object，`inputDrvs` 实际上也使用这个组合来表示需要哪个 Store Object 作为依赖。

Derivation 实际上还包括很多其他有用的信息，但是对于 DrvGraph 来说都是不重要的，所以以下的模型仅包括了部分字段：

```haskell
-- | The Nix derivation's data structure.
data Derivation = Derivation
    { inputDrvs :: Map DerivingPath (Set Text)
    , inputSrcs :: Set StoreObjectPath
    , outputs :: Map Text DerivationOutput
    }
    deriving (Eq, Show)

-- | The output field of a derivation.
data DerivationOutput = DerivationOutput
    { path :: StoreObjectPath
    , hash :: Maybe OutputHash
    }
    deriving (Eq, Show)

-- | The hash of a derivation's output.
data OutputHash = OutputHash
    { algo :: Text
    , val :: Text
    }
    deriving (Eq, Show)
```

可以看到 `DerivationOutput` 就是一个 Derivation 的其中的一个输出。其中的 `hash` 是可选的，因为在 Nix 中有所谓的 Fixed Output Derivation，其输出由哈希值固定，因此该 Derivation 的构建过程限制更少，通常用于被构建包的源代码的下载。

### Store Object

Store Object 是 Nix 求值过程中需要用到的被复制到 Nix Store 的文件、或 Derivation 的构建产出。Store Object 也有路径，在格式上和 Deriving Path 类似，在文件系统的 Nix Store 上可以是单个文件也可以是一个目录。由于 Store Object Path 和 Deriving Path 很容易区分，所以 Store Object 和 Derivation 也都可以存放在同一个 Store 中。

以下是 Store Object Path 的表示：

```haskell
-- | Path to a store object in the Nix store, without the store directory.
data StoreObjectPath = StoreObjectPath
    { hash :: Nix32Hash
    , name :: Text
    }
    deriving (Eq, Ord, Show)
```

作为构建产出的 Store Object，可能存在于远程的缓存服务器上，因此 Nix 在构建时会先查询所有的远程服务器以尝试避免重复构建。查询的结果是 NAR Info，表示为

```haskell
-- | Metadata of a NAR of a store object in the remote store.
data NarInfo = NarInfo
    { references :: Set StoreObjectPath
    , deriver :: Maybe DerivingPath
    }
    deriving (Eq, Show)
```

这只是 NAR Info 的一部分。其中 `references` 是这个 Store Object 对于其他 Store Object 的引用，这个 Store Object 的内容中包括了其他 Store Object 的路径。这也就说明，如果这个 Store Object 需要同步到本地，那么它引用的所有其他 Store Object 也需要被一起同步，依次类推就是整个闭包。`references` 就是 Store Object 的依赖关系表示。

`deriver` 则是记录了构建出这个 Store Object 的 Derivation 的 Deriving Path 是什么，不过由于 Nix 的一些设计，导致了这个字段实际上并不能可靠的反映真实的那个 Derivation 是什么，具体原因可以看[此帖](https://discourse.nixos.org/t/how-to-get-a-missing-drv-file-for-a-derivation-from-nixpkgs/2300).

### 依赖关系

首先可以认为 `(DerivingPath, Text)` 与 `StoreObjectPath` 一一对应，这里我们排除了 `inputSrcs` 的情况，它们其实对于这个算法没有用处。

Derivation 依赖 Store Object 表示构建时的依赖。

Store Object 可以依赖 Derivation，表示此 Store Object 是此 Derivation 的构建输出。也可以依赖 Store Object，表示运行期此 Store Object 引用了其他 Store Object。由于我们的算法是分析还没有构建或同步的 Store Object，所以如果在本地已经找到这个 Store Object，就可以中止往这里遍历了。所以 Store Object 一共有三种情况。

以下是它们在依赖图中的表示：

```haskell
-- | Direct acyclic graph structure of store objects and derivations, whose
-- edges represent the dependencies between entities. Node @A@ points to node
-- @B@ iff. entity @A@ depends on entity @B@. The node's path is the map key.
data DepGraph = DepGraph
    { objNodes :: Map StoreObjectPath ObjNode
    , drvNodes :: Map DerivingPath DrvNode
    , drvNodeIndegrees :: Map DerivingPath Int
    }
    deriving (Eq, Show)

-- | State of a store object.
data ObjNode
    = ObjExisted
    | ObjUnsynced
        { refPaths :: Set StoreObjectPath
        , deriver :: Maybe DerivingPath
        }
    | ObjUnbuilt
        { drvPath :: DerivingPath
        }
    deriving (Eq, Show)

-- | Inputs of the derivation.
newtype DrvNode = DrvNode
    { inputObjPaths :: Set StoreObjectPath
    }
    deriving (Eq, Show)
```

## 算法实现

### 深度优先遍历

DrvGraph 开发过程中的第一个算法是基于 DFS 的，完整的代码在[这里](https://github.com/StarryReverie/DrvGraph/blob/e3eae79c6624b2ed98722c239b5424dc38067c9b/hs-packages/drvgraph/src/DrvGraph/Core/Walk.hs)，这里就只摘取部分的代码。

首先是遍历过程的状态，遍历 DAG 需要记录已经遍历过的节点，并且需要把最终的依赖图逐步构建出来。这一版写法中，如果一个节点已经访问过了，就会存在于最终的依赖图中，所以没有单独记录一个已遍历节点集合：

```haskell
data WalkState = WalkState
    { loadedDrvCache :: Map DerivingPath Derivation
    , depGraph :: DepGraph
    }

makeFieldLabelsNoPrefix ''WalkState
```

然后是遍历算法的主体，`walk` 接收起始的 `DerivingPath` 和 Output Name `Text`，从这里开始遍历。`walk` 只初始化状态和从终止状态中提取结果，实际的遍历由 `walkImpl` 完成。

```haskell
-- | Traverse the Nix store from a derivation's output, which coresponds to a
-- store object path uniquely. Returns the dependency graph and the store object
-- path of the given @(DerivingPath, Text)@ pair.
walk
    :: (CapDerivation m, CapStoreObject m)
    => FilePath -> DerivingPath -> Text -> AppExceptT m (DepGraph, StoreObjectPath)
walk storeDir drvPath outName = do
    let initial = WalkState{loadedDrvCache = Map.empty, depGraph = DepGraph.empty}
    (objPath, WalkState{depGraph}) <- runStateT (walkImpl storeDir drvPath outName) initial
    pure (depGraph, objPath)

type CurrentT m = StateT WalkState (AppExceptT m)

walkImpl
    :: (CapDerivation m, CapStoreObject m)
    => FilePath -> DerivingPath -> Text -> CurrentT m StoreObjectPath
walkImpl storeDir drvPath outName = do
    -- Get the @Derivation@ at @drvPath@.
    drv <- ensureDerivation drvPath (CapDerivation.loadDerivation storeDir)

    -- Insert @drv@'s @DrvNode@ to the dependency graph, if not done yet.
    depGraph <- gets (^. #depGraph)
    drvNode <- case DepGraph.lookupDrvNode drvPath depGraph of
        Just drvNode -> pure drvNode
        Nothing -> do
            inputObjPaths <- resolveDrvInputObjPaths storeDir drv
            let drvNode = DrvNode{inputObjPaths}
            modify $ #depGraph %~ DepGraph.insertDrvNode drvPath drvNode
            pure drvNode

    -- Get the @StoreObjectPath@ of @drvPath@^@outName@.
    stObjPath <- case Map.lookup outName $ drv ^. #outputs of
        Just output -> do
            pure $ output ^. #path
        Nothing -> do
            let dp = DerivingPath.toText drvPath
            let errMsg = "derivation " <> dp <> " doesn't contain output " <> outName
            throwError $ appError errMsg

    -- Check whether we have visited the current store object path. If not,
    -- process it and recurse into its dependencies.
    maybeVisitedObj <- gets $ DepGraph.lookupObjNode stObjPath . (^. #depGraph)
    case maybeVisitedObj of
        Just _ -> pure ()
        Nothing -> resolveObjNodeAndRecurse storeDir drvPath stObjPath drvNode drv

    pure stObjPath
```

概括来说，每次都是加载 Derivation 并创建其节点 `DrvNode`、查询出 `(DerivingPath, Text)` 对应 `StoreObjectPath`，进而查询其是否在本地或远程缓存存在。对于需要本地构建的情况，就直接递归到当前 Derivation 的所有 `inputDrvs` 中。对于在缓存已经存在的情况，就只需要反推出 `references` 的 `(DerivingPath, Text)` 然后递归。

看上去代码非常杂乱。这里有一些假设不对的地方，导致了后来的重写，但除了这里，我们还看到了 Monad Transformer Stack `CurrentT`，混合了 `StateT` 和 `ExceptT`。这可以说是最错误的设计，`StateT` 的使用使得每到达一个节点就要修改一堆状态，搜索树上兄弟节点的遍历也因此有更强的顺序联系，整体非常串行化。

另外是 `ExceptT`，这又是一个坑，Haskell 虽然有 `Either e a` 这样的类型，但是这并不能作为错误处理的银弹。Haskell 和 Rust 不同，错误处理还有异常这一个体系。在我阅读了一些相关文章后，认识到了 Monad 中使用 `Either` 或 `ExceptT` 是一个非常不好的选择。使用异常会更加方便和安全（有些反直觉）。

### 广度优先遍历

实现深度优先遍历之后，我进行了一些测试，尽管结果比较正确，但是性能实在是太差了，显然串行的方法是不行的。那么想办法改成支持并发的版本，在遍历节点时，并行地遍历它的下一个节点。对于现有的 DFS 版本，有两个问题，第一是 `StateT` 实际上不适合并行，比如说 `forkIO` 这样创建线程，状态就会被复制到另外一个线程中，原来的线程和新线程的状态互不相关，`StateT` 的 `modify` 看上去是原位修改状态，实际上只是用 Monad 隐藏了状态的前后传递，根本没有状态的共享。第二，就算改用了引用类型，实现的代码也不够优雅，线程之间需要竞争修改状态，所以代码也不可避免需要依赖 IO，而我们更希望限制 IO 的使用。

所以我开始考虑 BFS。BFS 维护一个待访问节点的队列，并从队列中逐个取出节点进行处理。这就是 BFS 与 DFS 的最大差异。DFS 对于状态各个部分的处理是混合在一起的，同时又有多个执行流可以并发处理这些状态。DFS 到达一个节点后，修改已遍历节点集合、修改最终结果、计算下一系列要遍历的节点，然后往每个节点继续。如果往所有下一个节点遍历是各创建一个线程，那么执行流的数量就会随深度快速增长，同时状态修改的竞争也会更加分散和激烈，每一个执行流都在尝试修改已遍历节点集合和其他信息。这实际上就是共享内存的问题，为了限制竞争，可能需要使用信号量这样的机制。

反过来看 BFS。BFS 遍历每个节点和后续节点生成是分离的。处理节点从队头取出，生成下一个节点是插入到队尾。因此遍历节点的过程不需要考虑递归处理下一个节点，处理节点则完全由队头的过程决定，取出多少个节点就用多少线程处理，直接避免了信号量。遍历状态的修改也可以中心化处理，每个遍历节点的执行流可以不再直接修改中心状态，而是把需要做出的修改返回，最终状态修改就可以按顺序处理，避免了竞争。这也就是 BFS 可以存在一个中心化调度的过程与具体单个节点遍历分离，而不是像朴素的 DFS 一样必须用同一个过程做各种事情，从而可以更好避免 DFS 的问题。

回到 DrvGraph 的场景，处理节点是需要访问文件系统和网络，延迟很高，并行的优化将会非常显著。而调度部分只有内存状态的修改，速度快又不涉及到任何的副作用，就很适合串行执行。所以接下来就是适合并发的 BFS 的实现。在 DrvGraph 的开发过程中，实际上存在两个版本的 BFS，前一个实现仍然存在缺陷，即处理节点的过程依赖中心状态。虽然处理节点的代码不再直接修改，但是存在对状态的读取，这就存在不一致性的问题，也仍然要求中心状态用锁或 STM 保护。最终版本的 BFS 完全隔离了处理节点过程的状态访问，只将必要的信息提前传入，并在中心调度部分合并重复或冲突的状态更新。

首先是状态的定义：

```haskell
data WalkState = WalkState
    { depGraph :: DepGraph
    , toVisit :: Set QueuedElement
    , visited :: Set VisitedElement
    }

data QueuedElement
    = QueElemDrvOut
        { drvPath :: DerivingPath
        , outName :: Text
        }
    | QueElemObjWithDrv
        { objPath :: StoreObjectPath
        , drvPath :: DerivingPath
        }
    | QueElemObj
        { objPath :: StoreObjectPath
        }
    | QueElemDrv
        { drvPath :: DerivingPath
        }
    deriving (Eq, Ord, Show)

data VisitedElement
    = VisElemDrvOut
        { drvPath :: DerivingPath
        , outName :: Text
        }
    | VisElemObj
        { objPath :: StoreObjectPath
        }
    | VisElemDrv
        { drvPath :: DerivingPath
        }
    deriving (Eq, Ord, Show)

data StepResult
    = StepResDrvOut
        { nexts :: Set QueuedElement
        }
    | StepResObj
        { objPath :: StoreObjectPath
        , objNode :: ObjNode
        , nexts :: Set QueuedElement
        }
    | StepResDrv
        { drvPath :: DerivingPath
        , drvNode :: DrvNode
        , nexts :: Set QueuedElement
        }
    deriving (Eq, Show)
```

我把各种节点处理过程表示为 `QueuedElement`，各部分的含义如下：

- `QueElemDrvOut`：处理 Deriving Path 和 Output Name，查询此 Derivation 的特定 Output 的 Store Object Path。
    - 这个处理不对状态进行修改，但是会触发下一步对这个 Store Object Path 的查询。
- `QueElemObjWithDrv`：处理 Store Object Path 及产生它的 Deriving Path，查询此 Store Object 的相关信息并构造 `ObjNode`。
    - 传入对应 Deriving Path 的目的是，当这个 Store Object 不存在缓存时，可以本地构建，因此需要遍历对应的 Derivation。
- `QueElemObj`：处理 Store Object Path，查询此 Store Object 的相关信息并构造 `ObjNode`。
    - 这个并不知道对应的确切的 Deriving Path，一般是 NAR Info 中的。
- `QueElemDrv`：处理 Deriving Path，并构造 `DrvNode`。

每个节点的处理过程也会返回相应的结果，表示为 `StepResult`，包括对于状态的增量修改部分和下一个要遍历的节点集合。已遍历节点集合的修改就不在这里表示了。

可以先看如何取出一个节点：

```haskell
popFront :: WalkState -> (Maybe QueuedElement, WalkState)
popFront state = case Set.toList (Set.take 1 (state ^. #toVisit)) of
    [] -> (Nothing, state)
    front : _ ->
        let visFront = queuedToVisitedElem front
        in  if Set.member visFront (state ^. #visited)
                then popFront (state & #toVisit %~ Set.drop 1)
                else
                    ( Just front
                    , state
                        & #toVisit %~ Set.drop 1
                        & #visited %~ Set.insert visFront
                    )

queuedToVisitedElem :: QueuedElement -> VisitedElement
queuedToVisitedElem QueElemDrvOut{drvPath, outName} = VisElemDrvOut{drvPath, outName}
queuedToVisitedElem QueElemObjWithDrv{objPath} = VisElemObj{objPath}
queuedToVisitedElem QueElemObj{objPath} = VisElemObj{objPath}
queuedToVisitedElem QueElemDrv{drvPath} = VisElemDrv{drvPath}
```

由于在队列中的节点可能带有附加数据，在已遍历节点集合中仅需要记录用于标识的部分，所以有 `queuedToVisitedElem` 函数，然后在 `popFront` 函数中会把队列头节点再次进行检查，只有真正没有访问过的才会出队。

接下来是每个节点的处理过程：

```haskell
runStep
    :: (CapDerivation m, CapStoreObject m, MonadCatch m)
    => FilePath -> QueuedElement -> m StepResult
runStep storeDir queElem = case queElem of
    QueElemDrvOut{drvPath, outName} -> runStepDrvOut storeDir drvPath outName
    QueElemObjWithDrv{objPath, drvPath} -> runStepObjWithDrv storeDir objPath drvPath
    QueElemObj{objPath} -> runStepObj storeDir objPath
    QueElemDrv{drvPath} -> runStepDrv storeDir drvPath

runStepDrvOut
    :: (CapDerivation m, MonadCatch m)
    => FilePath -> DerivingPath -> Text -> m StepResult
runStepDrvOut storeDir drvPath outName = do
    drv <- loadDrv storeDir drvPath
    objPath <- lookupOut drvPath drv outName
    let next = QueElemObjWithDrv{objPath, drvPath}
    pure StepResDrvOut{nexts = Set.singleton next}

runStepObjWithDrv
    :: (CapStoreObject m, MonadCatch m)
    => FilePath -> StoreObjectPath -> DerivingPath -> m StepResult
runStepObjWithDrv storeDir objPath drvPath = do
    maybeObjNode <- queryObjNode storeDir objPath
    case maybeObjNode of
        Just (objNode, nexts) -> pure StepResObj{objPath, objNode, nexts}
        Nothing -> do
            let objNode = ObjUnbuilt{drvPath}
            let nexts = Set.singleton QueElemDrv{drvPath}
            pure StepResObj{objPath, objNode, nexts}

runStepObj
    :: (CapStoreObject m, MonadCatch m)
    => FilePath -> StoreObjectPath -> m StepResult
runStepObj storeDir objPath = do
    maybeObjNode <- queryObjNode storeDir objPath
    case maybeObjNode of
        Just (objNode, nexts) -> pure StepResObj{objPath, objNode, nexts}
        Nothing -> do
            let opText = StoreObjectPath.toText objPath
            throwAppErrorText $ "no narinfo for " <> opText <> ", don't know how to build"

runStepDrv
    :: (CapDerivation m, MonadCatch m)
    => FilePath -> DerivingPath -> m StepResult
runStepDrv storeDir drvPath = do
    drv <- loadDrv storeDir drvPath
    paths <- resolveDrvInputObjPaths storeDir drvPath drv
    let drvNode = DrvNode{inputObjPaths = Map.keysSet paths}
    let nexts = Set.fromList $ uncurry QueElemDrvOut <$> Map.elems paths
    pure StepResDrv{drvPath, drvNode, nexts}
```

`runStep` 根据节点类型进行不同的处理，具体的过程分为：

- `runStepDrvOut`：根据 `DerivingPath` 和 `Text`，加载 Derivation，查询其特定输出的 `StoreObjectPath`。下一个节点访问这个 `StoreObjectPath`
- `runStepObjWithDrv`：
    - 首先查询此 `StoreObjectPath` 是否在本地存在。
    - 否则再查询此 `StoreObjectPath` 是否在缓存上存在，并获取其 `references`，随后遍历这些 Store Object。
    - 否则按照本地构建处理，链接到 `drvPath` 上，随后遍历这个 Derivation。
- `runStepObj`：
    - 首先查询此 `StoreObjectPath` 是否在本地存在。
    - 否则再查询此 `StoreObjectPath` 是否在缓存上存在，并获取其 `references`，随后遍历这些 Store Object。
    - 否则退出，无法构建。
- `runStepDrv`：加载 Derivation，并获取其依赖的所有 Store Object Path。

我认为这里最关键的就是，所有的处理过程都没有依赖中心状态，所以这些函数天生适合并发。

最后是状态合并和调度部分：

```haskell
-- | Traverse the Nix store from a derivation's output, which coresponds to a
-- store object path uniquely. Returns the dependency graph and the store object
-- path of the given @(DerivingPath, Text)@ pair.
walk
    :: (CapDerivation m, CapStoreObject m, CapTaskExecutor m, MonadCatch m)
    => FilePath -> DerivingPath -> Text -> m (DepGraph, StoreObjectPath)
walk storeDir drvPath outName = do
    let initial =
            WalkState
                { depGraph = DepGraph.empty
                , toVisit = Set.singleton (QueElemDrvOut{drvPath, outName})
                , visited = Set.empty
                }

    WalkState{depGraph} <- CapTaskExecutor.withTaskExecutor $ walkLoop storeDir initial

    objPath <- do
        drv <- loadDrv storeDir drvPath
        lookupOut drvPath drv outName

    pure (depGraph, objPath)

walkLoop
    :: (CapDerivation m, CapStoreObject m, MonadCatch m)
    => FilePath -> WalkState -> (m StepResult -> m (), m (Maybe StepResult)) -> m WalkState
walkLoop storeDir state (submit, await) = case popFront state of
    (Nothing, newState) ->
        await >>= \case
            Nothing -> pure newState
            Just res -> do
                let nextState = mergeResult newState res
                walkLoop storeDir nextState (submit, await)
    (Just front, newState) -> do
        submit $ runStep storeDir front
        walkLoop storeDir newState (submit, await)

mergeResult :: WalkState -> StepResult -> WalkState
mergeResult state res = case res of
    StepResDrvOut{nexts} -> state & #toVisit %~ Set.union nexts
    StepResObj{objPath, objNode, nexts} ->
        state
            & #toVisit %~ Set.union nexts
            & #depGraph %~ DepGraph.insertObjNode objPath objNode
    StepResDrv{drvPath, drvNode, nexts} ->
        state
            & #toVisit %~ Set.union nexts
            & #depGraph %~ DepGraph.insertDrvNode drvPath drvNode
```

状态只有 `popFront` 和 `mergeResult` 可以更新，而它们都只能由调度部分的 `walkLoop` 使用。`walkLoop` 可以把所有的遍历过程都加入一个 Task Executor 中，实际上用线程池实现。`submit` 接受一个遍历过程的计算，加入 Executor 中。`await` 则产生阻塞等待一个已经完成的计算结果。

通过精细地分离，调度主循环 `walkLoop` 变得异常简洁，除了为了性能而不得不使用 `submit` 和 `await` 这样的复杂一些的控制机制。

这份 BFS 实现分离了调度和遍历，分离了状态的计算和副作用执行，比起 DFS 版本更加清晰，是我比较满意的一个版本。

## 总结

为什么我觉得最终的 BFS 版本比之前的版本更优雅呢，我认为这是由于对于副作用和并发访问的隔离。其实这个 BFS 代码也类似 Actor 模式，并发的状态修改被串行化、中心化地处理，从而从根源上避免了竞态条件。好的代码应当尽可能减少副作用、尽可能使用简单的控制结构。

同时对于 BFS 来说，我们可以编写更加结构化的代码，分为 Pop-Process-Update 三部分的 BFS，更容易理解和分析。
