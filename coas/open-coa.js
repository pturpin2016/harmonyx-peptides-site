async function loadCoaPdf(name) {
  const archives = ["coas-pdfs.zip", "coas-pdfs (4).zip", "coas-pdfs%20(4).zip"];
  let lastErr = new Error("Could not load certificate archive");
  for (const archive of archives) {
    try {
      const res = await fetch(archive);
      if (!res.ok) continue;
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      const file = zip.file("coas/" + name) || zip.file(name);
      if (!file) throw new Error("PDF not found: " + name);
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
