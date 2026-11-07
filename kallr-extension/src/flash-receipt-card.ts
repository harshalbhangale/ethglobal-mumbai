import {
  advanceReceipt,
  type FlashReceipt,
  type ReceiptEvent,
  receiptRows,
  savingsLine,
  startReceipt,
} from "@kallr/domain/flash-receipt";
import { el, safeLink } from "./dom";
import { STEP_LABEL, type Step } from "./flash-direct";

/**
 * The Definitive Flash receipt on the X card: quote, signature, order ID and fill, one row each,
 * filled in as each step happens. Same model as the web app (@kallr/domain/flash-receipt). Styled
 * by class only (styles.ts): X's CSP can block inline style attributes.
 */

/** A MetaMask placement step (placeOnX) as receipt events. `from` is the wallet, once connected. */
export function stepEvents(step: Step, from?: string | null): ReceiptEvent[] {
  if (step === "connecting" || step === "quoting") return [{ type: "quoting" }];
  if (step === "submitting") return [...(from ? [{ type: "signed", wallet: from } as const] : []), { type: "sending" }];
  return [{ type: "signing", wallet: from ?? null, note: STEP_LABEL[step] }];
}

export function flashReceiptRows(signer: string) {
  let state: FlashReceipt = startReceipt(signer);
  const list = el("ol", { class: "fr-rows", "aria-live": "polite" });
  const saved = el("p", { class: "fr-saved", hidden: "" });
  const root = el(
    "section",
    { class: "flash-receipt", "aria-label": "Definitive Flash receipt" },
    el("p", { class: "fr-head" }, el("span", {}, "Definitive Flash receipt"), el("span", { class: "fr-chain" }, "Base")),
    list,
    saved,
  );
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const render = () => {
    // Flash beat Uniswap on this trade: say it in dollars, once the order is on its way.
    const line = !state.error && state.at >= 1 ? savingsLine(state.quote) : null;
    saved.hidden = !line;
    saved.replaceChildren(...(line ? [el("span", {}, `✓ ${line}`), el("span", { class: "fr-saved-by" }, "Definitive Flash")] : []));
    list.replaceChildren(
      ...receiptRows(state).map((row, i) => {
        const detail = el("span", { class: (row.key === "signed" || row.key === "sent") && row.state === "done" ? "fr-detail-text mono" : "fr-detail-text" }, row.detail);
        const line = el("span", { class: "fr-detail" }, detail);
        if (row.copy) {
          const value = row.copy;
          const copy = el("button", { type: "button", class: "fr-copy", title: `Copy the Flash order ID: ${value}` }, "Copy");
          copy.addEventListener("click", () => {
            void navigator.clipboard?.writeText(value).then(
              () => {
                copy.textContent = "Copied";
                if (copiedTimer) clearTimeout(copiedTimer);
                copiedTimer = setTimeout(() => (copy.textContent = "Copy"), 1500);
              },
              () => {},
            );
          });
          line.append(copy);
        }
        if (row.link) line.append(safeLink(row.link.href, row.link.label, "fr-link"));
        return el(
          "li",
          { class: `fr-row ${row.state}`, "data-row": row.key },
          el("span", { class: "fr-dot", "aria-hidden": "true" }, row.state === "done" ? "✓" : row.state === "failed" ? "!" : row.state === "pending" ? String(i + 1) : ""),
          el("span", { class: "fr-body" }, el("span", { class: "fr-title" }, row.title), line),
        );
      }),
    );
  };
  render();

  return {
    root,
    emit(...events: ReceiptEvent[]) {
      state = events.reduce(advanceReceipt, state);
      render();
    },
    get state() {
      return state;
    },
  };
}

export type FlashReceiptRows = ReturnType<typeof flashReceiptRows>;
