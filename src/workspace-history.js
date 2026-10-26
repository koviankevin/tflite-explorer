import {parseWorkspace,exportWorkspace} from './workspace.js';
export const HISTORY_BYTES=8*1024*1024;

// Whole UI snapshots are small and exclude the model/weights. Keep both a count
// and a byte budget; a new edit after Undo discards only its in-memory redo tail.
export class WorkspaceHistory {
    constructor({limit=50,bytes=HISTORY_BYTES}={}) {this.limit=limit;this.budget=bytes;this.clear();}
    clear(){this.entries=[];this.position=-1;this.bytes=0;}
    get current(){return this.entries[this.position]?.text || null;}
    get canUndo(){return this.position>0;}
    get canRedo(){return this.position>=0 && this.position<this.entries.length-1;}
    push(workspace) {
        const text=typeof workspace==='string'?exportWorkspace(parseWorkspace(workspace)):exportWorkspace(workspace);
        if(text===this.current)return false;
        this.entries.splice(this.position+1);this.entries.push({text,bytes:new TextEncoder().encode(text).length});
        this.bytes=this.entries.reduce((n,e)=>n+e.bytes,0);this.position=this.entries.length-1;
        while(this.entries.length>1 && (this.entries.length>this.limit || this.bytes>this.budget)){this.bytes-=this.entries.shift().bytes;this.position--;}
        return true;
    }
    target(delta){const position=this.position+delta;return position>=0 && position<this.entries.length?{position,workspace:parseWorkspace(this.entries[position].text)}:null;}
    move(position){if(!Number.isInteger(position) || !this.entries[position])throw new Error('找不到復原版本。');this.position=position;}
}
