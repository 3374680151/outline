import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { ySyncPluginKey } from "y-prosemirror";
import Extension from "@shared/editor/lib/Extension";
import BilingualStore from "~/stores/BilingualStore";
import { MIRROR_WRITE_META } from "~/utils/bilingual/editorBlocks";
import { registerMirrorFlashListener } from "~/utils/bilingual/mirrorFlash";
import type { MirrorEngine } from "~/utils/bilingual/mirrorEngine";
import { observeBlockVisibility } from "~/utils/bilingual/visibility";

/** How long the freshly written mirror block stays highlighted. */
const MIRROR_FLASH_MS = 1500;

/** Plugin state carrying the block currently being highlighted. */
interface MirrorFlashState {
  index: number;
  until: number;
}

const flashKey = new PluginKey<MirrorFlashState | null>(
  "bilingual-mirror-flash"
);

/** Live bilingual state of the host editor, resolved at event time. */
export interface BilingualMirrorState {
  /** Which side of the active pair this editor is, if any. */
  side: "source" | "target" | undefined;
  /** The mirror engine while the bilingual view is active. */
  engine: MirrorEngine | null;
}

/**
 * Options for the bilingual mirror extension.
 */
interface BilingualMirrorOptions {
  /** Resolves the live bilingual state of the host editor. */
  getState: () => BilingualMirrorState;
}

/**
 * Bridges a ProseMirror editor instance and the bilingual MirrorEngine. The
 * extension is installed in every document editor; it only acts when the
 * bilingual view is active and this document belongs to the open pair. On
 * the source pane it observes local transactions (remote ones are mirrored
 * by their originating client); on the target pane it tracks human edits and
 * structure consistency.
 */
export default class BilingualMirrorExtension extends Extension<BilingualMirrorOptions> {
  get defaultOptions(): BilingualMirrorOptions {
    return {
      getState: () => ({ side: undefined, engine: null }),
    };
  }

  get name() {
    return "bilingual-mirror";
  }

  get plugins() {
    const getState = this.options.getState;

    return [
      new Plugin<MirrorFlashState | null>({
        key: flashKey,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(flashKey) as MirrorFlashState | null;

            if (meta !== undefined) {
              return meta;
            }

            return value;
          },
        },
        props: {
          decorations: (state) => {
            const flash = flashKey.getState(state);

            if (!flash || Date.now() > flash.until) {
              return DecorationSet.empty;
            }

            if (flash.index >= state.doc.childCount) {
              return DecorationSet.empty;
            }

            // Top-level block boundaries straight from the document: the
            // flash index is parallel on both panes.
            let from = 0;

            for (let i = 0; i < flash.index; i++) {
              from += state.doc.child(i).nodeSize;
            }

            const to = from + state.doc.child(flash.index).nodeSize;

            return DecorationSet.create(state.doc, [
              Decoration.node(from, to, {
                class: "bilingual-mirror-flash",
              }),
            ]);
          },
        },
        appendTransaction: (trs, _oldState, newState) => {
          const { side, engine } = getState();

          if (!side || !engine || !trs.some((tr) => tr.docChanged)) {
            return null;
          }

          if (side === "source") {
            const isLocal = trs.every((tr) => !tr.getMeta(ySyncPluginKey));

            if (isLocal) {
              engine.handleLocalTransactions();
            } else {
              engine.handleRemoteTransactions();
            }
          } else {
            const isLocal = trs.every((tr) => !tr.getMeta(ySyncPluginKey));
            const isEngineWrite = trs.some((tr) =>
              tr.getMeta(MIRROR_WRITE_META)
            );

            // A human typed into the mirror document: protect that block
            // from future overwrites. Writes dispatched by the engine itself
            // carry the mirror meta and must not be mistaken for edits.
            if (isLocal && !isEngineWrite) {
              const index = newState.selection
                ? newState.selection.$from.index(0)
                : -1;

              if (index >= 0) {
                engine.markHumanEdited(index);
              }
            }

            engine.checkConsistency();
          }

          return null;
        },
        view: (editorView) => {
          const documentId = this.editor?.props.id as string | undefined;

          // The view is always registered so the engine can adopt it once a
          // pair resolves; editors commonly mount before the pair is known.
          if (documentId) {
            BilingualStore.registerEditor(documentId, editorView);
          }

          const { side, engine } = getState();
          let unregisterFlash: (() => void) | null = null;

          if (side && engine) {
            if (side === "source") {
              engine.registerSource(editorView);

              // Feed viewport visibility to the engine so translation work
              // can prioritize (or restrict itself to) visible content.
              const visibilityObserver = observeBlockVisibility(
                editorView,
                (indexes) => engine.markBlocksVisible(indexes)
              );

              return {
                destroy: () => {
                  visibilityObserver.disconnect();

                  if (documentId) {
                    BilingualStore.unregisterEditor(documentId);
                  }
                },
              };
            }

            engine.registerTarget(editorView);

            // The target pane renders the write-flash decoration; the mirror
            // engine announces writes through the module registry.
            unregisterFlash = registerMirrorFlashListener((index) => {
              const until = Date.now() + MIRROR_FLASH_MS;

              editorView.dispatch(
                editorView.state.tr.setMeta(flashKey, { index, until })
              );
              window.setTimeout(() => {
                if (editorView.isDestroyed) {
                  return;
                }

                const current = flashKey.getState(editorView.state);

                if (current?.until === until) {
                  editorView.dispatch(
                    editorView.state.tr.setMeta(flashKey, null)
                  );
                }
              }, MIRROR_FLASH_MS + 50);
            });
          }

          return {
            destroy: () => {
              unregisterFlash?.();

              if (documentId) {
                BilingualStore.unregisterEditor(documentId);
              }
            },
          };
        },
      }),
    ];
  }
}
