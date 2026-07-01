const bars = Array.from({ length: 52 }, (_, index) => {
  const base = 18 + Math.abs(Math.sin(index * 0.52)) * 42;
  const pulse = index % 6 === 0 ? 10 : 0;
  return Math.round(base + pulse + (index % 4) * 3);
});

const waveform = document.getElementById("waveform");
if (waveform) {
  bars.forEach((height, index) => {
    const bar = document.createElement("span");
    bar.style.height = `${height}px`;
    if (index % 7 === 0) {
      bar.style.background = "linear-gradient(180deg, #64d9ff, #844dff)";
    }
    waveform.appendChild(bar);
  });
}

const dateNode = document.getElementById("currentDate");
if (dateNode) {
  const now = new Date();
  dateNode.textContent = now.toLocaleDateString("hr-HR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
