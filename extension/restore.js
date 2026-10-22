const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tabId"));

const statusEl = document.getElementById("status");
const targetTitleEl = document.getElementById("target-title");
const targetUrlEl = document.getElementById("target-url");

targetTitleEl.textContent = params.get("title") || "(unknown)";
targetUrlEl.textContent = params.get("url") || "(unknown)";

function resetLog() {
  statusEl.classList.remove("error");
  statusEl.textContent = "";
}

function log(line) {
  statusEl.textContent += `${line}\n`;
  console.log(line);
}

function logError(line) {
  statusEl.classList.add("error");
  statusEl.textContent += `ERROR: ${line}\n`;
  console.error(line);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeEntries(entries, storageName) {
  if (!isPlainObject(entries)) {
    throw new Error(`"${storageName}" is missing or is not an object in this dump.`);
  }

  const normalized = {};

  for (const [key, value] of Object.entries(entries)) {
    normalized[key] = value === null || value === undefined ? "" : String(value);
  }

  return normalized;
}

function normalizeDump(raw) {
  if (!isPlainObject(raw)) {
    throw new Error("The selected file is not a JSON object.");
  }

  const dump = {
    url: typeof raw.url === "string" ? raw.url : "",
    origin: typeof raw.origin === "string" ? raw.origin : "",
    localStorage: normalizeEntries(raw.localStorage, "localStorage"),
    sessionStorage: normalizeEntries(raw.sessionStorage, "sessionStorage"),
  };

  const keyCount =
    Object.keys(dump.localStorage).length + Object.keys(dump.sessionStorage).length;

  if (keyCount === 0) {
    throw new Error(
      "The dump contains no storage keys, so the target storage was NOT cleared. " +
        "If this file was created by an older version of this extension, take a new dump first."
    );
  }

  return dump;
}

function originFromUrl(value) {
  if (!value) return "";

  try {
    const origin = new URL(value).origin;
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
}

function writeStoragesInPage(dump, expectedOrigin) {
  const currentOrigin = location.origin;

  if (expectedOrigin && expectedOrigin !== currentOrigin) {
    throw new Error(
      `Origin mismatch. Dump origin: ${expectedOrigin}. Target tab origin: ${currentOrigin}. Nothing was written.`
    );
  }

  const readStorage = (storage) => {
    const entries = {};

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      entries[key] = storage.getItem(key);
    }

    return entries;
  };

  const writeStorage = (storage, entries) => {
    storage.clear();

    for (const key of Object.keys(entries)) {
      storage.setItem(key, entries[key]);
    }
  };

  const sameStorage = (expected, actual) => {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();

    if (expectedKeys.join("\u0000") !== actualKeys.join("\u0000")) return false;

    return expectedKeys.every((key) => expected[key] === actual[key]);
  };

  const totalKeys =
    Object.keys(dump.localStorage).length + Object.keys(dump.sessionStorage).length;

  if (totalKeys === 0) {
    throw new Error("Dump contains no keys. Nothing was written.");
  }

  writeStorage(window.localStorage, dump.localStorage);
  writeStorage(window.sessionStorage, dump.sessionStorage);

  const result = {
    origin: currentOrigin,
    url: location.href,
    counts: {
      localStorage: Object.keys(dump.localStorage).length,
      sessionStorage: Object.keys(dump.sessionStorage).length,
    },
    verified:
      sameStorage(dump.localStorage, readStorage(window.localStorage)) &&
      sameStorage(dump.sessionStorage, readStorage(window.sessionStorage)),
  };

  return result;
}

async function restoreDump(dump) {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error(
      'Missing target tab id. Open this page from the extension popup\'s "Restore dump" button.'
    );
  }

  const expectedOrigin = dump.origin || originFromUrl(dump.url);
  let results;

  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: writeStoragesInPage,
      args: [dump, expectedOrigin],
    });
  } catch (error) {
    throw new Error(
      `${error.message} The target tab may be closed, may have navigated, or may be a ` +
        "restricted page (chrome://, Web Store, PDF viewer). Reopen the popup on the target " +
        'tab and click "Restore dump" again.'
    );
  }

  const injection = results && results[0];

  if (!injection) throw new Error("The script did not run in the target tab.");
  if (injection.error) throw new Error(injection.error.message || String(injection.error));
  if (!injection.result) throw new Error("The script returned no result.");

  return injection.result;
}

document.getElementById("restore").addEventListener("change", (event) => {
  const file = event.target.files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = async (e) => {
    resetLog();

    try {
      log(`File: ${file.name}`);

      const raw = JSON.parse(e.target.result);
      const dump = normalizeDump(raw);
      const dumpOrigin = dump.origin || originFromUrl(dump.url) || "(unknown)";

      log(`Dump origin: ${dumpOrigin}`);
      log(`Dump URL: ${dump.url || "(unknown)"}`);
      log(
        `Keys in dump: ${Object.keys(dump.localStorage).length} local, ` +
          `${Object.keys(dump.sessionStorage).length} session`
      );
      log("Writing storage into the target tab...");

      const result = await restoreDump(dump);

      log(`Written to: ${result.url} (${result.origin})`);
      log(`localStorage: ${result.counts.localStorage} keys`);
      log(`sessionStorage: ${result.counts.sessionStorage} keys`);
      log(`Verification: ${result.verified ? "OK" : "FAILED - keys do not match after writing"}`);

      if (!result.verified) {
        throw new Error("Storage was written but read-back verification did not match.");
      }

      if (document.getElementById("reload").checked) {
        log("Reloading the target tab...");
        await chrome.tabs.reload(tabId);
        log("Done. The target tab was reloaded.");
      } else {
        log("Done. Reload the target tab manually so the app rehydrates from storage.");
      }
    } catch (error) {
      logError(error.message);
    } finally {
      event.target.value = "";
    }
  };

  reader.onerror = () => logError("Could not read the selected file.");

  reader.readAsText(file);
});
