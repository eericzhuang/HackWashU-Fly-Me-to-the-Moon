import type { Word } from "../../shared/types";

/** One absolutely positioned box per word, in % of the image, so the boxes follow the image's on-screen size. */
export function renderBoxes(container: HTMLElement, words: Word[], confident: number[], imageWidth: number, imageHeight: number): void {
  const w = imageWidth || 1;
  const h = imageHeight || 1;
  container.replaceChildren(
    ...words.map((word, i) => {
      const b = document.createElement("div");
      b.className = confident.includes(i) ? "box confident" : "box";
      if (word.box.length === 0) {
        b.hidden = true;
        return b;
      }
      const xs = word.box.map((p) => p[0]);
      const ys = word.box.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      b.style.left = `${(x0 / w) * 100}%`;
      b.style.top = `${(y0 / h) * 100}%`;
      b.style.width = `${((Math.max(...xs) - x0) / w) * 100}%`;
      b.style.height = `${((Math.max(...ys) - y0) / h) * 100}%`;
      return b;
    }),
  );
}

/** index = the word being spoken; earlier words count as said; null clears. */
export function highlightBoxes(container: HTMLElement, index: number | null): void {
  Array.from(container.children).forEach((b, i) => {
    b.classList.toggle("said", index !== null && i < index);
    b.classList.toggle("now", i === index);
  });
}
