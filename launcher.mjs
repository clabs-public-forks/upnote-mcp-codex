import { spawn as nodeSpawn } from "node:child_process";

export function openerForPlatform(platform = process.platform) {
  switch (platform) {
    case "win32":
      return ["rundll32", ["url.dll,FileProtocolHandler"]];
    case "darwin":
      return ["open", []];
    default:
      return ["xdg-open", []];
  }
}

export function callbackUrl(endpoint, params) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `upnote://x-callback-url/${endpoint}${query ? `?${query}` : ""}`;
}

export function openUrl(url, { platform = process.platform, spawnImpl = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const [command, prefixArgs] = openerForPlatform(platform);
    const args = [...prefixArgs, url];
    let child;
    try {
      child = spawnImpl(command, args, { shell: false, stdio: "ignore", detached: true });
    } catch (error) {
      reject(launchError(command, error));
      return;
    }

    let settled = false;
    const succeed = () => {
      if (settled) return;
      settled = true;
      child.unref?.();
      resolve();
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(launchError(command, error));
    };
    child.once("error", fail);
    child.once("spawn", succeed);
  });
}

function launchError(command, error) {
  return new Error(
    `Could not launch "${command}" to open the UpNote link (${error.message}). ` +
    "Is UpNote installed and is the upnote:// scheme registered?"
  );
}

export function createLauncher(options = {}) {
  return { open: url => openUrl(url, options) };
}
