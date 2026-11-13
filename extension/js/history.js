import { state, emit } from "./state.js";
import { deepCopy } from "./util.js";

const MAX = 80;

function snapshot() {
  return deepCopy(state.annotations);
}

export const history = {
  past: [],
  future: [],
  pending: null,

  push() {
    this.pending = null;
    this.past.push(snapshot());
    if (this.past.length > MAX) this.past.shift();
    this.future = [];
    emit("history");
  },

  begin() {
    this.pending = snapshot();
    return this.pending;
  },

  beginAt(snap) {
    this.pending = snap;
    return snap;
  },

  commit(before) {
    const b = before || this.pending;
    this.pending = null;
    if (!b) return false;
    if (JSON.stringify(b) === JSON.stringify(state.annotations)) return false;
    this.past.push(b);
    if (this.past.length > MAX) this.past.shift();
    this.future = [];
    emit("history");
    return true;
  },

  rollback() {
    const b = this.pending;
    this.pending = null;
    if (!b) return false;
    state.annotations = b;
    state.selection = null;
    emit("changed");
    return true;
  },

  discard() {
    this.pending = null;
  },

  undo() {
    this.pending = null;
    if (!this.past.length) return false;
    this.future.push(snapshot());
    state.annotations = this.past.pop();
    state.selection = null;
    emit("changed");
    emit("history");
    return true;
  },

  redo() {
    this.pending = null;
    if (!this.future.length) return false;
    this.past.push(snapshot());
    state.annotations = this.future.pop();
    state.selection = null;
    emit("changed");
    emit("history");
    return true;
  },

  canUndo() {
    return this.past.length > 0;
  },

  canRedo() {
    return this.future.length > 0;
  },
};
