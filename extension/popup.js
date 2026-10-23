const dumpFileName = "storagesDump.json";
const fileType = "application/json;charset=utf-8";

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) throw new Error("No active tab found");

  return tab;
}

function readStoragesInPage() {
  const readStorage = (storage) => {
    const entries = {};

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      entries[key] = storage.getItem(key);
    }

    return entries;
  };

  return {
    url: location.href,
    origin: location.origin,
    capturedAt: new Date().toISOString(),
    localStorage: readStorage(window.localStorage),
    sessionStorage: readStorage(window.sessionStorage),
  };
}

async function getStoragesDump() {
  const tab = await getActiveTab();

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: readStoragesInPage,
  });

  if (!injection || !injection.result) {
    throw new Error("Could not read storage from this tab");
  }

  return injection.result;
}

function downloadDump(blobContent) {
  const blob = new Blob([blobContent], { type: fileType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = dumpFileName;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById("dump").addEventListener("click", async () => {
  try {
    setStatus("Reading storage...");

    const dump = await getStoragesDump();
    const localCount = Object.keys(dump.localStorage).length;
    const sessionCount = Object.keys(dump.sessionStorage).length;

    downloadDump(JSON.stringify(dump, null, 2));
    setStatus(`Dumped ${localCount} local / ${sessionCount} session keys`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("open-restore").addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    const url = new URL(chrome.runtime.getURL("restore.html"));

    url.searchParams.set("tabId", tab.id);
    url.searchParams.set("url", tab.url || "");
    url.searchParams.set("title", tab.title || "");

    await chrome.tabs.create({ url: url.toString() });
    window.close();
  } catch (error) {
    setStatus(error.message, true);
  }
});
