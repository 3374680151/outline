import { Plugin } from "prosemirror-state";
import { ySyncPluginKey } from "y-prosemirror";
import Extension from "@shared/editor/lib/Extension";
import BilingualStore from "~/stores/BilingualStore";
import { MIRROR_WRITE_META } from "~/utils/bilingual/editorBlocks";
import type { MirrorEngine } from "~/utils/bilingual/mirrorEngine";
import { observeBlockVisibility } from "~/utils/bilingual/visibility";

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
      new Plugin({
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
          }

          return {
            destroy: () => {
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
