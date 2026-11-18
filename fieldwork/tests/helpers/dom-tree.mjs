// Tree-aware boundary double: reparenting changes event bubbling, queries and
// connected state just as it does in the browser. Observers are flushed in a
// bounded queue so a self-triggering placement loop fails instead of hanging.
export function sectionDOM(){
  const observers=[];
  const matches=(node,selector)=>{
    if(selector.includes(' ')){const parts=selector.split(/\\s+/),last=parts.pop();if(!matches(node,last))return false;for(let parent=node.parentElement;parent;parent=parent.parentElement)if(matches(parent,parts.join(' ')))return true;return false;}
    const combined=/^([a-z][\\w-]*)(\\[.+\\])$/.exec(selector);if(combined)return node.tag===combined[1]&&matches(node,combined[2]);
    if(selector.startsWith('#'))return node.id===selector.slice(1);
    if(selector.startsWith('.'))return (node.attrs.class||'').split(/\s+/).includes(selector.slice(1));
    const attr=/^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if(attr)return attr[1] in node.attrs&&(attr[2]===undefined||node.attrs[attr[1]]===attr[2]);
    return node.tag===selector;
  };
  const notify=target=>{for(const observer of observers)if(observer.target&&(observer.target===target||observer.options.subtree&&observer.target.contains(target)))observer.pending=true;};
  class Element{
    constructor(tag='div',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.parentElement=null;this.listeners=new Map();this.dataset={};this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this.value=attrs.value||'';for(const[key,value]of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
    get id(){return this.attrs.id;}
    get isConnected(){return Boolean(this.root||this.parentElement?.isConnected);}
    get nextElementSibling(){const list=this.parentElement?.children||[];return list[list.indexOf(this)+1]||null;}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    set innerHTML(html){
      for(const child of this.children)child.parentElement=null;this.children=[];this.html=html;
      const stack=[this],voids=new Set(['input','br','hr','img','meta','link']);
      for(const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){
        if(match[1]){if(stack.at(-1)?.tag===match[2])stack.pop();continue;}
        const attrs=Object.fromEntries([...match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(item=>[item[1],item[2]??''])),node=new Element(match[2],attrs);
        node.parentElement=stack.at(-1);node.parentElement.children.push(node);if(!voids.has(node.tag)&&!match[3].endsWith('/'))stack.push(node);
      }
      notify(this);
    }
    get innerHTML(){return this.html||'';}
    querySelectorAll(selector){const selectors=selector.split(',').map(value=>value.trim()),found=[];const visit=node=>{for(const child of node.children){if(selectors.some(value=>matches(child,value)))found.push(child);visit(child);}};visit(this);return found;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    after(node){const parent=this.parentElement,old=node.parentElement;if(old){old.children.splice(old.children.indexOf(node),1);notify(old);}parent.children.splice(parent.children.indexOf(this)+1,0,node);node.parentElement=parent;notify(parent);}
    replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];for(const node of nodes){const old=node.parentElement;if(old){old.children.splice(old.children.indexOf(node),1);notify(old);}node.parentElement=this;this.children.push(node);}notify(this);}
    setAttribute(key,value){this.attrs[key]=String(value);}
    removeAttribute(key){delete this.attrs[key];}
    getAttribute(key){return this.attrs[key]??null;}
    hasAttribute(key){return key in this.attrs;}
    prepend(...nodes){this.replaceChildren(...nodes,...this.children.filter(child=>!nodes.includes(child)));}
    focus(){this.focused=true;}
    addEventListener(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list);}
    closest(selector){return matches(this,selector)?this:this.parentElement?.closest(selector)||null;}
    async click(){
      if(this.disabled)return;const path=[];for(let node=this;node;node=node.parentElement)path.push(node);
      const pending=[],event={target:this,currentTarget:null,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
      for(const node of path){event.currentTarget=node;for(const listener of [...(node.listeners.get('click')||[]),...(node.onclick?[node.onclick]:[])])pending.push(listener.call(node,event));if(event.stopped)break;}
      await Promise.all(pending);
    }
  }
  class MutationObserver{constructor(callback){this.callback=callback;observers.push(this);}observe(target,options){this.target=target;this.options=options;}disconnect(){this.target=null;this.pending=false;}}
  const flush=()=>{for(let pass=0;pass<20;pass++){const pending=observers.filter(observer=>observer.pending);if(!pending.length)return;for(const observer of pending){observer.pending=false;observer.callback([]);}}throw new Error('Navigation placement caused an observer loop.');};
  const el=new Element();el.root=true;
  return{el,Element,MutationObserver,flush};
}

