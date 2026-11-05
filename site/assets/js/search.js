const searchKey = "q";

const nodeSearchForm = document.getElementById("search-form");
const nodeSearchInput = document.getElementById("search-input");
const nodeSearchButton = document.getElementById("search-button");
const nodeSearchNoResult = document.getElementById("search-no-result");
const nodeSearchResults = document.getElementById("search-results");

const tmplSearchResultEntry = document.getElementById("template-search-result-entry");
const tmplSearchHighlight = document.getElementById("template-search-highlight");

async function main() {
  nodeSearchInput.focus();

  const searchData = await fetch("/index.json").then((response) => response.json());

  nodeSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch(searchData);
  });

  nodeSearchButton.addEventListener("click", () => {
    runSearch(searchData);
  });

  const currentInput = new URLSearchParams(location.search).get(searchKey) || "";
  if (currentInput !== "") {
    nodeSearchInput.value = currentInput;
    runSearch(searchData);
  }
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
  contentNode.attributes.removeNamedItem("id");

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
  linkNode.attributes.removeNamedItem("id");
  linkNode.setAttribute("href", searchEntry.link);

  const titleNode = node.getElementById("search-result-entry-title");
  titleNode.attributes.removeNamedItem("id");
  titleNode.innerHTML = searchEntry.title;

  const headingsNode = node.getElementById("search-result-entry-headings");
  headingsNode.attributes.removeNamedItem("id");
  headingsNode.innerHTML = searchEntry.headings.reduce((acc, h) => `${acc} &gt; ${h}`, "");

  const summaryNode = node.getElementById("search-result-entry-summary");
  if (searchEntry.summary !== "") {
    summaryNode.innerHTML = searchEntry.summary;
  } else {
    summaryNode.classList.toggle("hidden", true);
  }

  return node;
}

function applySearchResults(results) {
  if (results.length === 0) {
    nodeSearchNoResult.classList.toggle("hidden", false);
    nodeSearchResults.classList.toggle("hidden", true);
  } else {
    nodeSearchResults.innerHTML = "";
    results.forEach((result) => {
      nodeSearchResults.appendChild(result);
    });

    nodeSearchNoResult.classList.toggle("hidden", true);
    nodeSearchResults.classList.toggle("hidden", false);
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
