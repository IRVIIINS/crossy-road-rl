// Save text as a file (web / Electron: shows the normal "save as" behaviour).
export function download(filename: string, text: string, mime = "text/plain") {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    console.warn("download failed", e);
  }
}

// Save an image that ships inside the app (a bundled asset URL).
export async function downloadUrl(filename: string, url: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  } catch (e) {
    console.warn("download failed", e);
  }
}
