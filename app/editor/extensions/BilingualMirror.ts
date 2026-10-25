import { Plugin } from "prosemirror-state";
import { ySyncPluginKey } from "y-prosemirror";
import Extension from "@shared/editor/lib/Extension";
import BilingualStore from "~/stores/BilingualStore";
import type { MirrorEngine } from "~/utils/bilingual/mirrorEngine";

/**
 * Options for the bilingual mirror extension.
 */
interface BilingualMirrorOptions {
  /** The mirror engine driving the synchronization. */
  engine: MirrorEngine;
  /** Which pane of the pair this editor instance is. */
  side: "source" | "target";
}

/**
 * Bridges a ProseMirror editor instance and the bilingual MirrorEngine.
 * On the source pane it observes local transactions (remote ones are
 * mirrored by their originating client); on the target pane it tracks human
 * edits and structure consistency.
 */
export default class BilingualMirrorExtension extends Extension<BilingualMirrorOptions> {
  get defaultOptions(): BilingualMirrorOptions {
    return {
      engine: undefined as unknown as MirrorEngine,
      side: "source",
    };
  }

  get name() {
    return "bilingual-mirror";
  }

  get plugins() {
    const { engine, side } = this.options;
    const documentId = this.editor?.props.id as string | undefined;

    return [
      new Plugin({
        appendTransaction: (trs, _oldState, _newState) => {
          if (!trs.some((tr) => tr.docChanged)) {
            return null;
          }

          if (side === "source") {
            const isLocal = trs.every((tr) => !tr.getMeta(ySyncPluginKey));

            if (isLocal) {
              engine.handleLocalTransactions(trs, _oldState, _newState);
            } else {
              engine.handleRemoteTransactions();
            }
          } else {
            const isLocal = trs.every((tr) => !tr.getMeta(ySyncPluginKey));

            if (isLocal) {
              // A human typed into the mirror document: protect the block.
              const index = _newState.selection
                ? _newState.selection.$from.index(0)
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
          if (side === "source") {
            engine.registerSource(editorView);
          } else {
            engine.registerTarget(editorView);
          }

          if (documentId) {
            BilingualStore.registerEditor(documentId, editorView);
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
