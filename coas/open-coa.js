async function loadCoaPdf(name) {
  const res = await fetch("coas-pdfs.zip");
  if (!res.ok) throw new Error("Could not load certificate archive");
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const file = zip.file("coas/" + name) || zip.file(name);
  if (!file) throw new Error("PDF not found: " + name);
  const blob = await file.async("blob");
  return URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
}
async function openCoaFromPage() {
  const base = location.pathname.split("/").pop().replace(/\.html$/i, "");
  const name = base + ".pdf";
  const status = document.getElementById("status");
  try {
    if (status) status.textContent = "Opening lab PDF…";
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
