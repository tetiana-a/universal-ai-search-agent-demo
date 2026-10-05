"use client";

import { useEffect } from "react";

// Text lines that fade in one after another with a soft blur when they scroll into view
// and hide again when they leave, so the effect repeats in both scroll directions.
const LINE_SELECTOR = "p, h1, h2, h3, h4, h5, li, dt, dd, blockquote, figcaption, [data-reveal-line]";
// Controls, data tables, the logo and floating UI keep their text visible at all times.
const SKIP_SELECTOR =
  "button, a[role='button'], input, textarea, select, label, table, nav, .brand-logo, .fixed, [role='dialog'], [data-no-reveal]";
const STAGGER_MS = 70;
const MAX_STAGGER_STEPS = 10;

export default function LineReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    const tracked = new WeakSet<Element>();

    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
        entering.forEach((entry, index) => {
          const node = entry.target as HTMLElement;
          node.style.setProperty("--line-delay", Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS + "ms");
          node.dataset.line = "in";
        });
        entries.forEach((entry) => {
          if (entry.isIntersecting) return;
          const node = entry.target as HTMLElement;
          node.style.setProperty("--line-delay", "0ms");
          node.dataset.line = "out";
        });
      },
      { rootMargin: "0px 0px -4% 0px" },
    );

    // The line is the nearest block-level box around a piece of text (flex and grid items count as blocks).
    const lineFor = (element: HTMLElement): HTMLElement | null => {
      let node: HTMLElement | null = element;
      while (node && node !== document.body) {
        if (!getComputedStyle(node).display.startsWith("inline")) return node;
        node = node.parentElement;
      }
      return null;
    };

    const hasOwnText = (element: Element) =>
      Array.from(element.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());

    const track = (scope: ParentNode) => {
      const found = new Set<HTMLElement>();
      const elements = Array.from(scope.querySelectorAll<HTMLElement>("*"));
      if (scope instanceof HTMLElement) elements.unshift(scope);
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        if (!element.matches(LINE_SELECTOR) && !hasOwnText(element)) continue;
        if (element.closest(SKIP_SELECTOR)) continue;
        const line = lineFor(element);
        if (!line || tracked.has(line) || !line.textContent?.trim()) continue;
        found.add(line);
      }
      for (const line of found) {
        // Animate the innermost line only, so nested lines do not blur twice.
        if (Array.from(found).some((other) => other !== line && line.contains(other))) continue;
        tracked.add(line);
        line.dataset.line = "out";
        observer.observe(line);
      }
    };

    let pending = false;
    const added: ParentNode[] = [];
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) added.push(node);
          else if (node.parentElement) added.push(node.parentElement);
        });
      }
      if (pending || !added.length) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        added.splice(0).forEach(track);
      });
    });

    root.classList.add("line-reveal");
    track(document.body);
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      observer.disconnect();
      root.classList.remove("line-reveal");
    };
  }, []);

  return null;
}
