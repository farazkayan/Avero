#!/usr/bin/env node
/**
 * SPEC B.2 Virtualization Decision — Measure actual DOM node count
 * Run this in browser console on your LARGEST real Space timeline.
 *
 * Usage:
 *   1. Open SpaceDetailPage for your largest Space in Chrome
 *   2. Open DevTools Console
 *   3. Paste and run this script
 *   4. Report the numbers back
 */

(function measureDOM() {
  const cards = document.querySelectorAll('[data-memory-card]');
  const totalNodes = document.querySelectorAll('*').length;
  const cardNodes = Array.from(cards).reduce((sum, card) => sum + card.querySelectorAll('*').length, 0);
  const images = document.querySelectorAll('img').length;
  const videos = document.querySelectorAll('video').length;

  console.log("=== SPEC B.2 DOM Measurement ===");
  console.log(`Memory cards rendered: ${cards.length}`);
  console.log(`Total DOM nodes: ${totalNodes.toLocaleString()}`);
  console.log(`Nodes inside memory cards: ${cardNodes.toLocaleString()}`);
  console.log(`<img> elements: ${images}`);
  console.log(`<video> elements: ${videos}`);
  console.log(`Avg nodes per card: ${cards.length ? Math.round(cardNodes / cards.length) : 0}`);

  // Scroll performance test
  console.log("\n--- Scroll Performance Test ---");
  console.log("Scroll the page now. Watch for jank (frame drops) in DevTools Performance tab.");
  console.log("Record a 5-second scroll profile and check:");

  let frameDrops = 0;
  let lastFrame = performance.now();
  function checkFrame() {
    const now = performance.now();
    if (now - lastFrame > 16.67) frameDrops++;
    lastFrame = now;
    requestAnimationFrame(checkFrame);
  }
  requestAnimationFrame(checkFrame);

  setTimeout(() => {
    console.log(`\nFrame drops in 5s: ${frameDrops}`);
    console.log(frameDrops > 10 ? "⚠️ MEASURABLE JANK — virtualization may help" : "✅ SMOOTH — virtualization likely unnecessary");
  }, 5000);

  return { cards: cards.length, totalNodes, cardNodes, images, videos };
})();
