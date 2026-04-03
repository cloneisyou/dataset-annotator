/**
 * Entry point — routing, landing page, HuggingFace integration, drag-drop.
 * Unified for desktop and mobile datasets (device detection happens in viewer).
 */
import { FEATURED_DATASETS, MORE_DATASETS } from "./config.js";
import { fetchFileList, fetchLocalFileList, hasFiles, renderFileTree } from "./hf.js";
import { loadFromFiles, loadFromUrls } from "./viewer.js";
import { updateStatus } from "./ui.js";

// Landing page initialization
function initLanding() {
  const featured = document.getElementById("featured-datasets");
  const more = document.getElementById("more-datasets");

  for (const ds of FEATURED_DATASETS) {
    const li = document.createElement("li");
    li.innerHTML = `<a href="?repo_id=${ds}">${ds}</a>`;
    featured.appendChild(li);
  }

  for (const ds of MORE_DATASETS) {
    const li = document.createElement("li");
    li.innerHTML = `<a href="?repo_id=${ds}">${ds}</a>`;
    more.appendChild(li);
  }

  // Search box
  const input = document.getElementById("dataset-input");
  const goBtn = document.getElementById("go-btn");
  const go = () => {
    const v = input.value.trim();
    if (v) location.href = `?repo_id=${v}`;
  };
  goBtn?.addEventListener("click", go);
  input?.addEventListener("keyup", (e) => {
    if (e.key === "Enter") go();
  });

  // File drop zone
  const dropZone = document.getElementById("drop-zone");
  const mcapInput = document.getElementById("mcap-input-landing");
  const mkvInput = document.getElementById("mkv-input-landing");
  const jsonInput = document.getElementById("json-input-landing");
  const fileStatus = document.getElementById("file-status");
  let mcap = null,
    mkv = null,
    pendingJson = null;

  function classifyFile(file) {
    if (file.name.endsWith(".mcap")) mcap = file;
    else if (/\.(mkv|mp4|webm)$/i.test(file.name)) mkv = file;
    else if (file.name.endsWith(".json")) pendingJson = file;
  }

  const loadNoJsonBtn = document.getElementById("load-no-json-btn");

  function update() {
    const parts = [];
    if (mcap) parts.push(`MCAP: ${mcap.name}`);
    if (mkv) parts.push(`MKV: ${mkv.name}`);
    if (pendingJson) parts.push(`JSON: ${pendingJson.name}`);
    fileStatus.textContent = parts.join("  ");
    mcapInput?.parentElement.classList.toggle("selected", !!mcap);
    mkvInput?.parentElement.classList.toggle("selected", !!mkv);
    jsonInput?.parentElement.classList.toggle("selected", !!pendingJson);

    // Auto-load when all 3 files are present
    if (mcap && mkv && pendingJson) {
      loadNoJsonBtn?.classList.add("hidden");
      fileStatus.textContent += "  — Loading...";
      loadFromFiles(mcap, mkv, fileStatus, pendingJson);
      return;
    }

    // Show "Load without JSON" button when MCAP + MKV are present
    if (mcap && mkv && !pendingJson) {
      loadNoJsonBtn?.classList.remove("hidden");
    } else {
      loadNoJsonBtn?.classList.add("hidden");
    }
  }

  // "Load without JSON" button
  loadNoJsonBtn?.addEventListener("click", () => {
    if (mcap && mkv) {
      loadNoJsonBtn.classList.add("hidden");
      fileStatus.textContent += "  — Loading...";
      loadFromFiles(mcap, mkv, fileStatus, null);
    }
  });

  mcapInput?.addEventListener("change", (e) => {
    mcap = e.target.files[0] || null;
    update();
  });
  mkvInput?.addEventListener("change", (e) => {
    mkv = e.target.files[0] || null;
    update();
  });
  jsonInput?.addEventListener("change", (e) => {
    pendingJson = e.target.files[0] || null;
    update();
  });

  dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    for (const f of e.dataTransfer.files) {
      classifyFile(f);
    }
    update();
  });
}

// Tree viewer (HuggingFace or local server)
async function initTreeViewer(fetchTree) {
  document.getElementById("landing")?.classList.add("hidden");
  document.getElementById("file-select")?.classList.add("hidden");
  document.getElementById("viewer").classList.remove("hidden");
  updateStatus("Fetching file list...");

  try {
    const tree = await fetchTree();
    if (!hasFiles(tree)) {
      updateStatus("No MCAP files found");
      return;
    }

    const section = document.getElementById("file-section");
    const container = document.getElementById("hf-file-list");
    section?.classList.remove("hidden");

    const firstLi = renderFileTree(tree, container, (f) => loadFromUrls(f.mcap, f.mkv));
    firstLi?.click();
  } catch (e) {
    updateStatus(`Error: ${e.message}`);
  }
}

// Direct URL viewer
async function initUrlViewer(mcapUrl, mkvUrl) {
  document.getElementById("landing")?.classList.add("hidden");
  document.getElementById("file-select").classList.remove("hidden");
  await loadFromUrls(mcapUrl, mkvUrl);
}

// Normalize URL by adding http:// if no protocol specified
function normalizeUrl(url) {
  if (url && !/^[a-z]+:\/\//i.test(url) && !url.startsWith("//")) {
    return `http://${url}`;
  }
  return url;
}

// Show dataset link in side panel
function showDatasetLink(repoId) {
  const container = document.getElementById("dataset-link");
  const anchor = document.getElementById("dataset-link-anchor");
  const text = document.getElementById("dataset-link-text");
  if (container && anchor && text) {
    anchor.href = `https://huggingface.co/datasets/${repoId}`;
    text.textContent = repoId;
    container.classList.remove("hidden");
  }
}

// Router
const params = new URLSearchParams(location.search);
const repoId = params.get("repo_id");
const baseUrl = normalizeUrl(params.get("base_url"));

if (repoId) {
  showDatasetLink(repoId);
  initTreeViewer(() => fetchFileList(repoId));
} else if (baseUrl) {
  initTreeViewer(() => fetchLocalFileList(baseUrl));
} else if (params.has("mcap") && params.has("mkv")) {
  initUrlViewer(params.get("mcap"), params.get("mkv"));
} else {
  document.getElementById("landing").classList.remove("hidden");
  initLanding();
}
