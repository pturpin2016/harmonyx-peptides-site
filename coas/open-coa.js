async function loadCoaPdf(name) {
  const archives = [];
  for (let i = 0; i <= 12; i++) {
    const suffix = i === 0 ? "" : " (" + i + ")";
    archives.push("coas-pdfs" + suffix + ".zip");
  }
  archives.push("coas-pdfs.zip");
  let lastErr = new Error("Could not load certificate archive");
  for (const archive of archives) {
    try {
      const res = await fetch(archive);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 1000) continue;
      const zip = await JSZip.loadAsync(buf);
      const file = zip.file("coas/" + name) || zip.file(name);
      if (!file) continue;
      const blob = await file.async("blob");
      return URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
async function openCoaFromPage() {
  const base = location.pathname.split("/").pop().replace(/\.html$/i, "");
  const name = base + ".pdf";
  const status = document.getElementById("status");
  try {
    if (status) status.textContent = "Opening lab PDF\u2026";
    const url = await loadCoaPdf(name);
    const frame = document.getElementById("frame");
    if (frame) {
      frame.src = url;
      if (status) status.style.display = "none";
    } else {
      location.replace(url);
    }
    const a = document.getElementById("download");
    if (a) { a.href = url; a.download = name; }
  } catch (err) {
    if (status) status.textContent = err.message;
    else document.body.textContent = err.message;
  }
}
