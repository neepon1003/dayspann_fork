/** カードや見出しの FLIP アニメーション（位置の差を取って、なめらかに動かす）。 */

export const FLIP_KEY_ATTR = "data-dayspann-key";
export const FLIP_DURATION_MS = 220;
export const APPEAR_DURATION_MS = 200;
export const FLIP_EASING = "ease";

export interface FlipRect {
  key: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface FlipDelta {
  key: string;
  dx: number;
  dy: number;
}

export interface FlipPlan {
  moves: FlipDelta[];
  appear: string[];
}

/** 折りたたみなどで見えていない（幅も高さも 0）要素は動かさない。 */
export function isHiddenFlipRect(rect: Pick<FlipRect, "width" | "height">): boolean {
  return rect.width <= 0 && rect.height <= 0;
}

export function cardFlipKey(path: string): string {
  return `card:${path}`;
}

export function sectionFlipKey(id: string): string {
  return `section:${id}`;
}

function forEachFlipElement(root: HTMLElement, visit: (element: HTMLElement, key: string) => void): void {
  const nodes = root.getElementsByTagName("*");
  for (let index = 0; index < nodes.length; index++) {
    const element = nodes.item(index);
    if (!(element instanceof HTMLElement)) continue;
    const key = element.getAttribute(FLIP_KEY_ATTR);
    if (key) visit(element, key);
  }
}

export function collectFlipRects(root: HTMLElement): Map<string, FlipRect> {
  const rects = new Map<string, FlipRect>();
  forEachFlipElement(root, (element, key) => {
    const box = element.getBoundingClientRect();
    if (isHiddenFlipRect(box)) return;
    rects.set(key, { key, top: box.top, left: box.left, width: box.width, height: box.height });
  });
  return rects;
}

/**
 * 入れ替えの前（first）と後（last）の位置から、動かす量と新しく出たキーを決める。
 * dx/dy は「今の位置から、元の位置まで戻す」量（FLIP の Invert）。
 */
export function computeFlipPlan(
  first: ReadonlyMap<string, FlipRect>,
  last: ReadonlyMap<string, FlipRect>
): FlipPlan {
  const moves: FlipDelta[] = [];
  const appear: string[] = [];
  for (const [key, lastRect] of last) {
    const firstRect = first.get(key);
    if (!firstRect) {
      appear.push(key);
      continue;
    }
    const dx = firstRect.left - lastRect.left;
    const dy = firstRect.top - lastRect.top;
    if (dx === 0 && dy === 0) continue;
    moves.push({ key, dx, dy });
  }
  return { moves, appear };
}

export function prefersReducedMotion(media?: Pick<MediaQueryList, "matches"> | null): boolean {
  return Boolean(media?.matches);
}

function findFlipElements(root: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  forEachFlipElement(root, (element, key) => {
    found.set(key, element);
  });
  return found;
}

/**
 * 入れ替え後の root に対して、位置のアニメーションと新しい要素のフェードインを始める。
 * 消えた要素は、すでに DOM から外れているので何もしない。
 * 初回描画（first が空）と「動きを減らす」設定のときは、何もしない。
 */
export function playFlipTransition(
  root: HTMLElement,
  first: ReadonlyMap<string, FlipRect>,
  options?: { reducedMotion?: boolean; durationMs?: number; appearMs?: number; easing?: string }
): void {
  if (options?.reducedMotion) return;
  if (first.size === 0) return;
  const last = collectFlipRects(root);
  const plan = computeFlipPlan(first, last);
  const elements = findFlipElements(root);
  const duration = options?.durationMs ?? FLIP_DURATION_MS;
  const appearMs = options?.appearMs ?? APPEAR_DURATION_MS;
  const easing = options?.easing ?? FLIP_EASING;

  for (const move of plan.moves) {
    const element = elements.get(move.key);
    if (!element) continue;
    element.animate(
      [{ transform: `translate(${move.dx}px, ${move.dy}px)` }, { transform: "translate(0px, 0px)" }],
      { duration, easing }
    );
  }
  for (const key of plan.appear) {
    const element = elements.get(key);
    if (!element) continue;
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: appearMs, easing });
  }
}
