update:
  nix flake update --flake .
  nix flake update --flake ./nix/flake/dev --inputs-from .
  git commit -m "chore: update flake inputs" --only -- ./flake.lock ./nix/flake/dev/flake.lock

new-post name:
  hugo new content ./content/posts/$(date "+%Y")/{{name}}/index.md

new-journal:
  hugo new content ./content/journals/$(date "+%Y")/$(date "+%m")/$(date "+%d")/$(date "+%H-%M")/index.md

dev:
  hugo serve --disableFastRender --forceSyncStatic --gc

serve:
  hugo serve --buildDrafts

build:
  hugo --minify
