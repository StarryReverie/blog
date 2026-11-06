const searchKey = "q";

const nodeSearchForm = document.getElementById("search-form");
const nodeSearchInput = document.getElementById("search-input");
const nodeSearchButton = document.getElementById("search-button");
const nodeSearchNoResult = document.getElementById("search-no-result");
const nodeSearchError = document.getElementById("search-error");
const nodeSearchResults = document.getElementById("search-results");

const tmplSearchResultEntry = document.getElementById("template-search-result-entry");
const tmplSearchHighlight = document.getElementById("template-search-highlight");

let searchDataPromise = requestSearchData();

async function main() {
  nodeSearchInput.focus();

  nodeSearchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onSearch();
  });

  nodeSearchButton.addEventListener("click", async () => {
    await onSearch();
  });

  const currentInput = new URLSearchParams(location.search).get(searchKey) || "";
  if (currentInput !== "") {
    nodeSearchInput.value = currentInput;
    nodeSearchInput.select();
    await onSearch();
  }
}

async function onSearch() {
  const searchData = await tryLoadSearchData();
  if (searchData !== null) {
    runSearch(searchData);
  } else {
    nodeSearchNoResult.setAttribute("hidden", null);
    nodeSearchError.removeAttribute("hidden");
    nodeSearchResults.setAttribute("hidden", null);
  }
}

async function tryLoadSearchData() {
  if (searchDataPromise === null) {
    searchDataPromise = requestSearchData();
  }

  try {
    const searchData = await searchDataPromise;
    return searchData;
  } catch (exception) {
    console.error("Failed to request /index.json: ", exception);
    searchDataPromise = null;
    return null;
  }
}

async function requestSearchData() {
  return await fetch("/index.json").then((response) => response.json());
}

function runSearch(searchData) {
  const input = nodeSearchInput.value;
  const res = input !== "" ? searchInput(input, searchData) : [];
  applySearchResults(res);
  syncUrlQuery(input);
}

function searchInput(input, data) {
  return data.flatMap((entry) => {
    const searchEntries = matchEntry(input, entry);
    return searchEntries.map((searchEntry) => buildSearchResultEntryNode(searchEntry));
  });
}

function matchEntry(input, entry) {
  const highlightTitleRes = highlightContent(input, entry.title);
  const highlightSummaryRes = highlightContent(input, entry.summary);
  let searchEntries = [];

  const baseSearchEntry = {
    title: highlightTitleRes.content,
    summary: highlightSummaryRes.content,
    headings: [],
    link: entry.link,
  };
  if (highlightTitleRes.hasHighlight || highlightSummaryRes.hasHighlight) {
    searchEntries.push(baseSearchEntry);
  }

  collectHeadingMatchedEntry(input, baseSearchEntry, [], entry.headings, searchEntries);

  return searchEntries;
}

function collectHeadingMatchedEntry(input, baseSearchEntry, headingPath, currentHeadings, searchEntries) {
  if (currentHeadings === null || currentHeadings.length === 0) {
    return;
  }
  currentHeadings.forEach((heading) => {
    const highlightHeadingRes = highlightContent(input, heading.Title);
    const newHeadingPath = headingPath.concat([highlightHeadingRes.content]);
    if (highlightHeadingRes.hasHighlight) {
      searchEntries.push({
        title: baseSearchEntry.title,
        summary: "",
        headings: newHeadingPath,
        link: `${baseSearchEntry.link}#${encodeURIComponent(heading.ID)}`,
      });
    }
    collectHeadingMatchedEntry(input, baseSearchEntry, newHeadingPath, heading.Headings, searchEntries);
  });
}

function highlightContent(unescapedPattern, content) {
  const node = document.importNode(tmplSearchHighlight.content, true);
  const contentNode = node.getElementById("search-highlight-content");
  contentNode.removeAttribute("id");

  contentNode.textContent = unescapedPattern;
  const pattern = contentNode.innerHTML;

  const regex = new RegExp(escapeRegExp(pattern), "gi");
  const newContent = content.replace(regex, (matched) => {
    contentNode.innerHTML = matched;
    return contentNode.outerHTML;
  });

  if (newContent !== content) {
    return { hasHighlight: true, content: newContent };
  } else {
    return { hasHighlight: false, content };
  }
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchResultEntryNode(searchEntry) {
  const node = document.importNode(tmplSearchResultEntry.content, true);

  const linkNode = node.getElementById("search-result-entry-link");
  linkNode.removeAttribute("id");
  linkNode.setAttribute("href", searchEntry.link);

  const titleNode = node.getElementById("search-result-entry-title");
  titleNode.removeAttribute("id");
  titleNode.innerHTML = searchEntry.title;

  const headingsNode = node.getElementById("search-result-entry-headings");
  headingsNode.removeAttribute("id");
  headingsNode.innerHTML = searchEntry.headings.reduce((acc, h) => `${acc} &gt; ${h}`, "");

  const summaryNode = node.getElementById("search-result-entry-summary");
  if (searchEntry.summary !== "") {
    summaryNode.innerHTML = searchEntry.summary;
  } else {
    summaryNode.setAttribute("hidden", null);
  }

  return node;
}

function applySearchResults(results) {
  if (results.length === 0) {
    nodeSearchNoResult.removeAttribute("hidden");
    nodeSearchError.setAttribute("hidden", null);
    nodeSearchResults.setAttribute("hidden", null);
  } else {
    nodeSearchResults.innerHTML = "";
    results.forEach((result) => {
      nodeSearchResults.appendChild(result);
    });

    nodeSearchNoResult.setAttribute("hidden", null);
    nodeSearchError.setAttribute("hidden", null);
    nodeSearchResults.removeAttribute("hidden");
  }
}

function syncUrlQuery(input) {
  const url = new URL(location.href);
  if (input.trim()) {
    url.searchParams.set(searchKey, input);
  } else {
    url.searchParams.delete(searchKey);
  }
  history.replaceState(null, "", url);
}

main();
