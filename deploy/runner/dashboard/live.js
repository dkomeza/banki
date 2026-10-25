// The Dashboard's one script (ADR-0015), served from its own origin: every
// page renders in full without it, and it only adds the streaming. On the Now
// page it swaps in the live view the server sends every 30 seconds, already
// escaped; on a running Stage's log it appends each new line as plain text,
// and reloads the page once the run ends, for the Stage's result.

const target = document.querySelector("[data-stream]");
if (target instanceof HTMLElement && typeof EventSource === "function" && target.dataset.stream) {
  const source = new EventSource(target.dataset.stream);
  if (target.dataset.mode === "replace") {
    source.addEventListener("view", (event) => {
      target.innerHTML = event.data;
    });
  } else {
    source.addEventListener("line", (event) => {
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
      const line = document.createElement("li");
      line.textContent = event.data;
      target.append(line);
      if (atBottom) window.scrollTo(0, document.body.scrollHeight);
    });
    source.addEventListener("end", () => {
      source.close();
      window.location.reload();
    });
  }
}
