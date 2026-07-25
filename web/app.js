/* ============================================================
   LUMORA — frontend
   Constelacion viva + logo reactivo + splash, portados de React
   a JS puro y CONECTADOS AL MOTOR REAL (FastAPI + Gemini).
   Capas: dom · api · Logo · Constellation · Component · App
   ============================================================ */
(() => {
  "use strict";

  const C = { blue:"#5A6BFF", violet:"#8C6BFF", cyan:"#6EE7F7", star:"#F7F8FB", bg:"#090B12" };

  /* ---------------- dom ---------------- */
  const dom = {
    el(tag, props = {}, kids = []) {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v != null) n.setAttribute(k, v);
      }
      for (const c of [].concat(kids)) if (c) n.append(c);
      return n;
    },
    clear(n){ while(n.firstChild) n.removeChild(n.firstChild); },
    esc(t){ return String(t??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); },
    svgLogo() {
      // SVG del logo Lumora: 6 nodos en orbita + nucleo. Los estados los da el CSS.
      const NS = "http://www.w3.org/2000/svg";
      const nodes = [[50,15,3,.8],[80.3,32.5,4,.6],[80.3,67.5,3.5,.9],[50,85,4.5,.7],[19.7,67.5,3,.8],[19.7,32.5,4,.6]];
      let circles = nodes.map(([cx,cy,r,o])=>`<circle cx="${cx}" cy="${cy}" r="${r}" class="lo-node" fill="${C.cyan}" opacity="${o}"/>`).join("");
      return `<svg viewBox="0 0 100 100"><g class="lo-orbit">${circles}
        <path d="M50 15 L80.3 32.5 L80.3 67.5 L50 85 L19.7 67.5 L19.7 32.5 Z" fill="none" stroke="url(#lg)" stroke-width="0.5" class="lo-lines"/></g>
        <path d="M50 35 Q50 50 35 50 Q50 50 50 65 Q50 50 65 50 Q50 50 50 35 Z" class="lo-core"/>
        <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${C.blue}" stop-opacity=".5"/><stop offset="1" stop-color="${C.violet}" stop-opacity=".5"/>
        </linearGradient></defs></svg>`;
    },
  };

  /* ---------------- UI: modal de confirmacion (reemplaza confirm) ---------------- */
  const Modal = {
    _resolve:null,
    init() {
      this.el=document.getElementById("modal");
      this.icon=document.getElementById("modalIcon");
      this.title=document.getElementById("modalTitle");
      this.body=document.getElementById("modalBody");
      this.ok=document.getElementById("modalOk");
      this.cancel=document.getElementById("modalCancel");
      this.ok.addEventListener("click",()=>this._close(true));
      this.cancel.addEventListener("click",()=>this._close(false));
      this.el.querySelector(".modal__backdrop").addEventListener("click",()=>this._close(false));
      document.addEventListener("keydown",(e)=>{ if(!this.el.classList.contains("is-hidden")&&e.key==="Escape") this._close(false); });
    },
    _ICONS:{
      danger:'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      info:'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1" stroke-linecap="round"/></svg>',
    },
    /** Devuelve una promesa que resuelve true/false. opts: {title, body(html), okText, tone} */
    confirm(opts) {
      return new Promise((res)=>{
        this._resolve=res;
        const tone=opts.tone||"danger";
        this.icon.className="modal__icon "+tone;
        this.icon.innerHTML=this._ICONS[tone]||this._ICONS.danger;
        this.title.textContent=opts.title||"¿Confirmar?";
        this.body.innerHTML=opts.body||"";
        this.ok.textContent=opts.okText||"Aceptar";
        this.ok.className="modal__btn "+(tone==="danger"?"modal__btn--danger":"modal__btn--primary");
        this.el.classList.remove("is-hidden");
        this.ok.focus();
      });
    },
    _close(val){ this.el.classList.add("is-hidden"); if(this._resolve){ this._resolve(val); this._resolve=null; } },
  };

  /* ---------------- UI: toasts (reemplaza alert) ---------------- */
  const Toast = {
    init(){ this.box=document.getElementById("toasts"); },
    _ICONS:{
      ok:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      err:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg>',
      info:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1" stroke-linecap="round"/></svg>',
    },
    show(msg, tone="info", ms=3200) {
      const t=document.createElement("div");
      t.className="toast toast--"+tone;
      t.innerHTML=`<span class="toast__ico">${this._ICONS[tone]||this._ICONS.info}</span><span></span>`;
      t.querySelector("span:last-child").textContent=msg;
      this.box.append(t);
      setTimeout(()=>{ t.classList.add("is-out"); setTimeout(()=>t.remove(),300); }, ms);
    },
    ok(m){ this.show(m,"ok"); }, err(m){ this.show(m,"err",4200); }, info(m){ this.show(m,"info"); },
  };

  /* ---------------- Backstage: panel de origen de una fuente ---------------- */
  const Backstage = {
    init() {
      this.el=document.getElementById("backstage");
      this.icon=document.getElementById("bsIcon");
      this.name=document.getElementById("bsName");
      this.loc=document.getElementById("bsLoc");
      this.content=document.getElementById("bsContent");
      document.getElementById("bsClose").addEventListener("click",()=>this.close());
      this.el.querySelector(".backstage__veil").addEventListener("click",()=>this.close());
      document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"&&this.el.classList.contains("is-open")) this.close(); });
    },
    _ICO:{
      pdf:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
      data:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>',
    },
    /** Abre el panel mostrando el fragmento de esta fuente. s = {source, locator, excerpt, ...} */
    open(s) {
      const kind=extKind(s.source);
      this.icon.className="bs__ficon "+kind;
      this.icon.innerHTML=this._ICO[kind]||this._ICO.pdf;
      this.name.textContent=s.source;
      this.name.title=s.source;
      this.loc.textContent=s.locator||"";
      dom.clear(this.content);
      // Mostramos el fragmento exacto que se uso, resaltado.
      const ex=s.excerpt||"(sin extracto disponible)";
      this.content.append(dom.el("div",{class:"doc-view"},[
        dom.el("p",{html:`<mark>${dom.esc(ex)}</mark>`}),
      ]));
      this.el.classList.add("is-open");
    },
    close(){ this.el.classList.remove("is-open"); },
  };

  /* ---------------- Tooltip global (montado en body, nunca recortado) ---------------- */
  const Tip = {
    el:null,
    _ensure() {
      if(this.el) return;
      this.el=document.createElement("div");
      this.el.className="tip-float";
      document.body.appendChild(this.el);
    },
    /** Liga un tooltip a un elemento. html = contenido. */
    bind(target, html) {
      this._ensure();
      const show=()=>{
        this.el.innerHTML=html;
        this.el.classList.add("is-shown");
        const r=target.getBoundingClientRect();
        const tw=this.el.offsetWidth, th=this.el.offsetHeight;
        let left=r.left + r.width/2 - tw/2;
        left=Math.max(10, Math.min(left, window.innerWidth - tw - 10));
        let top=r.top - th - 9;
        if(top < 10) top = r.bottom + 9;  // si no cabe arriba, va abajo
        this.el.style.left=left+"px";
        this.el.style.top=top+"px";
      };
      const hide=()=>this.el.classList.remove("is-shown");
      target.addEventListener("mouseenter",show);
      target.addEventListener("mouseleave",hide);
      target.addEventListener("focus",show);
      target.addEventListener("blur",hide);
      // si se hace scroll o clic, ocultar (evita tooltips flotando fuera de lugar)
      window.addEventListener("scroll",hide,true);
    },
  };

  /* ---------------- Logo (controlador de estado) ---------------- */
  const Logo = {
    mount(elId) { const e = document.getElementById(elId); if (e) e.innerHTML = dom.svgLogo(); return e; },
    all() { return document.querySelectorAll(".logo"); },
    setState(state) {
      // state: idle | listening | processing | responding
      Logo.all().forEach((l)=>{
        l.classList.remove("logo-idle","logo-listening","logo-processing","logo-responding");
        l.classList.add("logo-"+state);
      });
    },
  };

  /* ---------------- Constellation (fondo canvas reactivo) ---------------- */
  const Constellation = {
    canvas:null, ctx:null, particles:[], raf:null, t:0, aiState:"idle", docCount:0,
    cfg:{ speedMod:.15, connDist:135, connOp:.28, gravity:0, pulse:.012, converging:false },

    CONFIGS: {
      processing:{ speedMod:1.5, connDist:150, connOp:.5,  gravity:.0075, pulse:.05, converging:false },
      responding:{ speedMod:3,   connDist:170, connOp:.7,  gravity:.03,   pulse:.1,  converging:true  },
      listening: { speedMod:.2,  connDist:135, connOp:.38, gravity:.005,  pulse:.03, converging:false },
      idle:      { speedMod:.18, connDist:135, connOp:.28, gravity:0,     pulse:.014, converging:false },
    },

    init(canvasId) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext("2d");
      this._resize();
      window.addEventListener("resize", ()=>this._resize());
      this.seed();
      this._loop();
    },
    _resize(){ const r=this.canvas.getBoundingClientRect(); this.canvas.width=r.width; this.canvas.height=r.height; this.W=r.width; this.H=r.height; },
    seed() {
      const count = 35 + this.docCount*8;
      this.particles = Array.from({length:count},()=>({
        x:Math.random()*this.W, y:Math.random()*this.H,
        vx:(Math.random()-.5)*this.cfg.speedMod, vy:(Math.random()-.5)*this.cfg.speedMod,
        r:Math.random()*1.2+.3, phase:Math.random()*Math.PI*2,
      }));
    },
    setState(state) {
      this.aiState = state;
      this.cfg = { ...this.CONFIGS[state] || this.CONFIGS.idle };
    },
    setDocs(n){ if(n!==this.docCount){ this.docCount=n; this.seed(); } },

    _loop() {
      const render = () => {
        const { ctx, W, H, cfg } = this;
        this.t += cfg.pulse;
        ctx.fillStyle = "rgba(9,11,18,0.15)";
        ctx.fillRect(0,0,W,H);
        const cx=W/2, cy=H/2;

        this.particles.forEach((p,i)=>{
          if (cfg.converging) {
            p.vx += (cx-p.x)*cfg.gravity; p.vy += (cy-p.y)*cfg.gravity;
            p.x += p.vx*.1; p.y += p.vy*.1;
          } else {
            p.x += p.vx; p.y += p.vy;
            if (cfg.gravity>0){ p.vx+=(cx-p.x)*cfg.gravity*.01; p.vy+=(cy-p.y)*cfg.gravity*.01; }
            if (p.x<0||p.x>W) p.vx*=-1;
            if (p.y<0||p.y>H) p.vy*=-1;
            const sp=Math.hypot(p.vx,p.vy), mx=cfg.speedMod*2;
            if (sp>mx){ p.vx=(p.vx/sp)*mx; p.vy=(p.vy/sp)*mx; }
          }
          // conexiones
          for (let j=i+1;j<this.particles.length;j++){
            const q=this.particles[j], d=Math.hypot(p.x-q.x,p.y-q.y);
            if (d<cfg.connDist){
              const a=cfg.connOp*(1-d/cfg.connDist);
              ctx.strokeStyle = cfg.converging ? `rgba(140,107,255,${a})` : this.aiState==="processing" ? `rgba(110,231,247,${a})` : `rgba(90,107,255,${a})`;
              ctx.lineWidth = cfg.converging?1.5:.5;
              ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.stroke();
            }
          }
          // estrella
          const br = p.r + Math.sin(this.t+p.phase)*.5;
          ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(.1,br),0,Math.PI*2);
          ctx.fillStyle = cfg.converging ? "rgba(247,248,251,1)" : `rgba(247,248,251,${.5+Math.sin(this.t+p.phase)*.2})`;
          ctx.fill();
        });

        if (cfg.converging){
          const g=ctx.createRadialGradient(cx,cy,0,cx,cy,200);
          g.addColorStop(0,"rgba(140,107,255,0.2)"); g.addColorStop(1,"rgba(9,11,18,0)");
          ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
        }
        this.raf = requestAnimationFrame(render);
      };
      render();
    },
  };

  /* ---------------- Splash (intro cinematica) ---------------- */
  const Splash = {
    run(onDone) {
      const cv=document.getElementById("splashCanvas"), ctx=cv.getContext("2d");
      let W=cv.width=innerWidth, H=cv.height=innerHeight, raf, collapsing=false;
      const ps=Array.from({length:180},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.5,vy:(Math.random()-.5)*.5,r:Math.random()*1.5+.5}));
      const draw=()=>{
        ctx.fillStyle="rgba(9,11,18,0.2)"; ctx.fillRect(0,0,W,H);
        // mover primero
        ps.forEach((p)=>{
          if(collapsing){ p.x+=(W/2-p.x)*.05; p.y+=(H/2-p.y)*.05; }
          else { p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1; }
        });
        // dibujar conexiones (como en la constelación del fondo)
        const dist = collapsing ? 140 : 110;
        for(let a=0;a<ps.length;a++){
          for(let b=a+1;b<ps.length;b++){
            const dx=ps[a].x-ps[b].x, dy=ps[a].y-ps[b].y, d=Math.hypot(dx,dy);
            if(d<dist){
              const op=(collapsing?.5:.28)*(1-d/dist);
              ctx.strokeStyle=`rgba(140,107,255,${op})`;
              ctx.lineWidth=collapsing?1.2:.6;
              ctx.beginPath(); ctx.moveTo(ps[a].x,ps[a].y); ctx.lineTo(ps[b].x,ps[b].y); ctx.stroke();
            }
          }
        }
        // dibujar partículas
        ps.forEach((p)=>{
          ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
          ctx.fillStyle=`rgba(247,248,251,${collapsing?.9:.6})`; ctx.fill();
        });
        raf=requestAnimationFrame(draw);
      };
      draw();

      const texts=["Comprendiendo conocimiento…","Descubriendo relaciones…","Preparando contexto…","Lumora está lista."];
      const tEl=document.getElementById("splashText");
      let i=0;
      const tick=setInterval(()=>{ i++; if(i<texts.length){ tEl.style.animation="none"; void tEl.offsetWidth; tEl.style.animation="textFade .8s ease"; tEl.textContent=texts[i]; } },1100);

      setTimeout(()=>{ collapsing=true; }, 3400);
      setTimeout(()=>{
        clearInterval(tick); cancelAnimationFrame(raf);
        const sp=document.getElementById("splash"); sp.classList.add("is-out");
        setTimeout(()=>{ sp.remove(); onDone(); }, 1000);
      }, 4200);
    },
  };

  /* ---------------- api (unica capa que habla al servidor) ---------------- */
  const api = {
    async health(){ const r=await fetch("/api/health"); if(!r.ok) throw new Error(`health ${r.status}`); return r.json(); },
    async documents(){ const r=await fetch("/api/documents"); if(!r.ok) throw new Error(`docs ${r.status}`); return r.json(); },
    async ask(question){
      const r=await fetch("/api/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question})});
      if(!r.ok){ const t=await r.text().catch(()=>"" ); throw new Error(t.slice(0,200)||`HTTP ${r.status}`); }
      return r.json();
    },
    async upload(files){
      const fd=new FormData(); for(const f of files) fd.append("files",f);
      const r=await fetch("/api/upload",{method:"POST",body:fd});
      const d=await r.json().catch(()=>null);
      if(!r.ok){ const det=d&&d.detail; const msg=typeof det==="string"?det:(det&&det.mensaje)||`HTTP ${r.status}`; throw Object.assign(new Error(msg),{errores:(det&&det.errores)||[]}); }
      return d;
    },
    async remove(nombre){
      const r=await fetch("/api/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nombre})});
      const d=await r.json().catch(()=>null);
      if(!r.ok){ const det=d&&d.detail; throw new Error(typeof det==="string"?det:`HTTP ${r.status}`); }
      return d;
    },
    async toggle(nombre, activa){
      const r=await fetch("/api/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nombre,activa})});
      const d=await r.json().catch(()=>null);
      if(!r.ok){ const det=d&&d.detail; throw new Error(typeof det==="string"?det:`HTTP ${r.status}`); }
      return d;
    },
  };

  /* ---------------- Component (piezas reutilizables) ---------------- */
  const ICONS = {
    doc:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
    data:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>',
    check:'<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    analyze:'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>',
    explore:'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
    relate:'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6.5 7.5l4 8M17.5 7.5l-4 8"/></svg>',
    search:'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  };
  const ROUTE = { tabular:"consulta agregada", rag:"búsqueda semántica", sin_datos:"sin datos" };
  const extKind = (nombre)=>{ const e=(nombre.split(".").pop()||"").toLowerCase(); return e==="csv"?"data":e; };
  const extIcon = (nombre)=> extKind(nombre)==="data" ? ICONS.data : ICONS.doc;

  const Component = {
    DocCard(doc, onDelete, onToggle) {
      const kind = extKind(doc.nombre);
      const activa = doc.activa !== false;
      const del = dom.el("button",{class:"card__del",type:"button",title:"Eliminar estrella","aria-label":`Eliminar ${doc.nombre}`,
        html:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        onClick:(e)=>{ e.stopPropagation(); onDelete(doc.nombre, del); }});

      // Estrellita-toggle: brilla si activa, opaca si apagada. ES el boton.
      const starSvg='<svg class="starbtn__star" viewBox="0 0 24 24" width="15" height="15" stroke-width="1.5"><path d="M12 3l2.4 6.3L21 10l-5 4.2L17.5 21 12 17.3 6.5 21 8 14.2 3 10l6.6-.7z" stroke-linejoin="round"/></svg>';
      const star = dom.el("button",{class:"starbtn "+(activa?"is-on":"is-off"),type:"button",
        title:activa?"Estrella encendida · clic para apagar":"Estrella apagada · clic para encender",
        html:starSvg+`<span class="starbtn__lbl">${activa?"Brillando":"Apagada"}</span>`,
        onClick:(e)=>{ e.stopPropagation(); onToggle(doc.nombre, !activa, star); }});

      // "fragmentos" con tooltip global (montado en body, nunca recortado)
      const frag = dom.el("span",{class:"frag",tabindex:"0"},[ document.createTextNode(`${doc.fragmentos} fragmentos`) ]);
      Tip.bind(frag, `Cada estrella se divide en <strong>fragmentos</strong>: los pedazos en que Lumora la lee para encontrar respuestas. Más fragmentos = más contenido.`);

      const name = dom.el("div",{class:"card__name"+(activa?"":" is-off"),text:doc.nombre,title:doc.nombre});
      return dom.el("li",{},[ dom.el("div",{class:"card"},[
        del,
        dom.el("div",{class:"card__row"},[
          dom.el("div",{class:`card__ico ${kind}`, html:extIcon(doc.nombre)}),
          dom.el("div",{class:"card__body"},[ name,
            dom.el("div",{class:"card__meta"},[ frag, star ]),
          ]),
        ]),
      ])]);
    },
    Filter(label, value, active, onPick) {
      return dom.el("button",{class:"chipf"+(active?" is-on":""),type:"button",text:label,onClick:()=>onPick(value)});
    },
    HeroCard(icon, text, onPick) {
      return dom.el("button",{class:"hero__card",type:"button",onClick:()=>onPick(text)},[
        dom.el("span",{html:icon}), dom.el("span",{text}),
      ]);
    },
    UserMsg(text){ return dom.el("div",{class:"msg msg--user"},[ dom.el("div",{class:"bubble-user",text}) ]); },

    // Markdown basico -> HTML seguro. Convierte **negrita**, *cursiva*, saltos.
    md(texto){
      let h=dom.esc(texto);
      h=h.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>");   // **negrita**
      h=h.replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g,"$1<em>$2</em>"); // *cursiva*
      h=h.replace(/`([^`]+)`/g,"<code>$1</code>");           // `codigo`
      h=h.replace(/\n/g,"<br>");                              // saltos de linea
      return h;
    },

    // Respuesta: procesa Markdown y reemplaza [n] por referencias APA inline.
    // 'sources' da el nombre de archivo de cada cita; onOpen abre el backstage.
    Answer(text, sources, onOpen){
      const cont=dom.el("div",{class:"ai__text"});
      const porN={}; (sources||[]).forEach((s)=>{ porN[s.n]=s; });
      // Partimos el texto por las marcas [n] para intercalar referencias reales
      const html=Component.md(text);
      const partes=html.split(/(\[\d{1,2}\])/g);
      partes.forEach((p)=>{
        const m=p.match(/^\[(\d{1,2})\]$/);
        if(m && porN[+m[1]]){
          cont.append(Component.Ref(porN[+m[1]], onOpen));
        } else if(p){
          const span=document.createElement("span"); span.innerHTML=p; cont.append(span);
        }
      });
      return cont;
    },

    // Referencia inline estilo APA: icono + nombre corto + tooltip, clickeable
    Ref(s, onOpen){
      const kind=extKind(s.source);
      const corto=Component._nombreCorto(s.source);
      const ico=kind==="data"||kind==="csv" ? ICONS.data : (kind==="pdf"?ICONS.doc:ICONS.doc);
      const ref=dom.el("span",{class:"ref",role:"button",tabindex:"0",title:`${s.source} · ${s.locator}`,
        onClick:()=>onOpen&&onOpen(s), onKeydown:(e)=>{ if(e.key==="Enter"){e.preventDefault();onOpen&&onOpen(s);} }},[
        dom.el("span",{class:`ref__ico ${kind}`,html:ico}),
        dom.el("span",{class:"ref__txt",text:corto}),
      ]);
      return ref;
    },
    _nombreCorto(nombre){
      // "politica_interna_de_almacen_rev4.pdf" -> "política interna…"
      let base=nombre.replace(/\.[^.]+$/,"");            // sin extension
      base=base.replace(/[_-]+/g," ").trim();             // guiones -> espacios
      const palabras=base.split(" ");
      let corto=palabras.slice(0,2).join(" ");
      if(palabras.length>2 || corto.length>18) corto=corto.slice(0,18).trim()+"…";
      return corto;
    },
    Meta(route,count){
      const cls = route==="tabular" ? "pill pill--tab" : "pill pill--rag";
      const kids=[ dom.el("span",{class:cls,text:ROUTE[route]||route}) ];
      return dom.el("div",{class:"ai__meta"},kids);
    },
    Table(rows){
      if(!rows||!rows.length) return null;
      const cols=Object.keys(rows[0]);
      return dom.el("div",{class:"tbl-wrap"},[ dom.el("table",{},[
        dom.el("thead",{},[ dom.el("tr",{},cols.map((c)=>dom.el("th",{text:c}))) ]),
        dom.el("tbody",{},rows.map((r)=>dom.el("tr",{},cols.map((c)=>dom.el("td",{text:r[c]})))))
      ])]);
    },
    // Mensaje de cuota agotada, bonito, con contador de reintento
    CuotaMsg(reintentar){
      const wrap=dom.el("div",{class:"cuota"});
      const secs=Math.max(5, reintentar||60);
      const sub=dom.el("p",{class:"cuota__sub"});
      wrap.append(
        dom.el("div",{class:"cuota__ico",html:'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3l2.4 6.3L21 10l-5 4.2L17.5 21 12 17.3 6.5 21 8 14.2 3 10l6.6-.7z" stroke-linejoin="round"/></svg>'}),
        dom.el("p",{class:"cuota__title",text:"Lumora está tomando aire"}),
        sub,
      );
      let queda=secs;
      const pinta=()=>{ sub.textContent = queda>0 ? `Muchas consultas seguidas. Vuelve a intentar en ${queda}s…` : "Listo, ya puedes preguntar de nuevo."; };
      pinta();
      const timer=setInterval(()=>{ queda-=1; pinta(); if(queda<=0){ clearInterval(timer); wrap.classList.add("is-ready"); } },1000);
      return wrap;
    },

    AiMsg(onOpenSource) {
      const logo=dom.el("div",{class:"logo ai__logo",'data-size':"sm"}); logo.innerHTML=dom.svgLogo(); logo.classList.add("logo-processing");
      const content=dom.el("div",{class:"ai__content"},[ dom.el("div",{class:"typing"},[dom.el("span"),dom.el("span"),dom.el("span")]) ]);
      const node=dom.el("div",{class:"msg msg--ai"},[ dom.el("div",{class:"ai"},[logo,content]) ]);
      return {
        node, logo, content,
        resolve(r){
          logo.classList.remove("logo-processing"); logo.classList.add("logo-responding");
          dom.clear(content);
          // Cuota agotada: mensaje bonito, sin recuadro normal
          if(r.route==="cuota"){ content.append(Component.CuotaMsg(r.reintentar_en)); return; }
          const bubble=dom.el("div",{class:"ai__bubble"});
          // Boton copiar (copia solo el texto, sin referencias)
          const copyBtn=dom.el("button",{class:"ai__copy",type:"button",title:"Copiar respuesta",
            html:'<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10" stroke-linecap="round"/></svg><span>Copiar</span>'});
          copyBtn.addEventListener("click",()=>Component._copiar(r.answer, copyBtn));
          bubble.append(copyBtn);
          bubble.append(Component.Meta(r.route,(r.sources||[]).length));
          bubble.append(Component.Answer(r.answer, r.sources, onOpenSource));
          const t=Component.Table(r.table); if(t) bubble.append(t);
          content.append(bubble);
        },
        fail(msg){ logo.classList.remove("logo-processing"); dom.clear(content); content.append(dom.el("div",{class:"err-box",text:msg})); },
      };
    },
    _copiar(texto, btn){
      // Limpia las marcas [n] y el Markdown para copiar texto plano legible
      const limpio=(texto||"").replace(/\[\d{1,2}\]/g,"").replace(/\*\*(.+?)\*\*/g,"$1").replace(/\*(.+?)\*/g,"$1").replace(/`([^`]+)`/g,"$1").replace(/\s+/g," ").trim();
      navigator.clipboard.writeText(limpio).then(()=>{
        const lbl=btn.querySelector("span"); const orig=lbl.textContent;
        btn.classList.add("done"); lbl.textContent="Copiado";
        setTimeout(()=>{ btn.classList.remove("done"); lbl.textContent=orig; },1600);
      }).catch(()=>Toast.err("No se pudo copiar"));
    },
  };

  /* ---------------- App ---------------- */
  const HERO_CARDS = [
    [ICONS.analyze,"Analizar documentos"], [ICONS.explore,"Explorar datos"],
    [ICONS.relate,"Encontrar relaciones"], [ICONS.search,"Buscar información"],
  ];
  const SUG = {
    "Analizar documentos":"¿De qué tratan los documentos cargados?",
    "Explorar datos":"¿Cuál fue el producto más vendido en diciembre de 2015?",
    "Encontrar relaciones":"¿Qué región vendió más en todo el año?",
    "Buscar información":"Resume los puntos principales de las políticas.",
  };

  const App = {
    busy:false, started:false,

    boot() {
      // Montar logos y constelacion, correr splash, luego revelar la app.
      Logo.mount("splashLogo");
      Splash.run(()=>this.reveal());
    },

    reveal() {
      document.getElementById("app").classList.remove("is-hidden");
      requestAnimationFrame(()=>document.getElementById("app").classList.add("is-shown"));
      Logo.mount("brandLogo"); Logo.mount("heroLogo");
      Constellation.init("constellation");
      Constellation.setState("idle"); Logo.setState("idle");
      Modal.init(); Toast.init(); Backstage.init();
      this._cacheEls(); this._wire(); this._renderHero();
      this.health(); this.refreshDocs();
    },

    _cacheEls() {
      this.thread=document.getElementById("thread");
      this.hero=document.getElementById("hero");
      this.heroCards=document.getElementById("heroCards");
      this.form=document.getElementById("composer");
      this.input=document.getElementById("q");
      this.send=document.getElementById("send");
      this.dropzone=document.getElementById("dropzone");
      this.addBtn=document.getElementById("addBtn");
      this.fileInput=document.getElementById("fileInput");
      this.uploadStatus=document.getElementById("uploadStatus");
      this.docList=document.getElementById("docList");
      this.emptyDocs=document.getElementById("emptyDocs");
      this.starCount=document.getElementById("starCount");
      this.search=document.getElementById("search");
      this.filters=document.getElementById("filters");
      this.sysStat=document.getElementById("sysStat");
      this.sideDot=document.querySelector(".side__dot");
      this._docs=[]; this._filter="all"; this._query="";
    },

    _wire() {
      this.form.addEventListener("submit",(e)=>{ e.preventDefault(); this.ask(this.input.value); });
      this.dropzone.addEventListener("click",()=>this.fileInput.click());
      if(this.addBtn) this.addBtn.addEventListener("click",()=>this.fileInput.click());
      this.dropzone.addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();this.fileInput.click();} });
      this.fileInput.addEventListener("change",()=>{ if(this.fileInput.files.length) this.upload(this.fileInput.files); this.fileInput.value=""; });
      ["dragenter","dragover"].forEach((ev)=>this.dropzone.addEventListener(ev,(e)=>{e.preventDefault();this.dropzone.classList.add("is-drag");}));
      ["dragleave","drop"].forEach((ev)=>this.dropzone.addEventListener(ev,(e)=>{e.preventDefault();this.dropzone.classList.remove("is-drag");}));
      this.dropzone.addEventListener("drop",(e)=>{ const f=e.dataTransfer.files; if(f&&f.length) this.upload(f); });
      this.search.addEventListener("input",()=>{ this._query=this.search.value.trim().toLowerCase(); this._renderDocs(); });
    },

    _renderHero() {
      dom.clear(this.heroCards);
      HERO_CARDS.forEach(([icon,text])=>this.heroCards.append(Component.HeroCard(icon,text,(t)=>this.ask(SUG[t]||t))));
    },

    async health() {
      try { const s=await api.health(); const n=s.chunks||0; this.sysStat.textContent=`${n} fragmento${n===1?"":"s"} · en línea`; }
      catch { this.sysStat.textContent="sin conexión"; this.sideDot.classList.add("is-err"); }
    },

    async refreshDocs() {
      try { const { documents }=await api.documents(); this._setDocs(documents); }
      catch {/* no critico */}
    },

    _setDocs(docs) {
      this._docs=docs;
      Constellation.setDocs(docs.length);
      this.starCount.textContent=docs.length;
      this._renderFilters();
      this._renderDocs();
    },

    _renderFilters() {
      const tipos=[...new Set(this._docs.map((d)=>extKind(d.nombre)))].sort();
      dom.clear(this.filters);
      if(tipos.length<2) return;  // sin variedad, sin filtros
      const LABELS={ pdf:"PDF", data:"CSV", txt:"TXT", md:"MD" };
      this.filters.append(Component.Filter("Todas","all",this._filter==="all",(v)=>this._pickFilter(v)));
      tipos.forEach((t)=>this.filters.append(Component.Filter(LABELS[t]||t.toUpperCase(),t,this._filter===t,(v)=>this._pickFilter(v))));
    },

    _pickFilter(v){ this._filter=v; this._renderFilters(); this._renderDocs(); },

    _visibleDocs() {
      return this._docs.filter((d)=>{
        const okType=this._filter==="all"||extKind(d.nombre)===this._filter;
        const okQuery=!this._query||d.nombre.toLowerCase().includes(this._query);
        return okType&&okQuery;
      });
    },

    _renderDocs() {
      const vis=this._visibleDocs();
      dom.clear(this.docList);
      vis.forEach((d)=>this.docList.append(Component.DocCard(d,
        (nombre,btn)=>this.deleteStar(nombre,btn),
        (nombre,activa,btn)=>this.toggleStar(nombre,activa,btn))));
      this.emptyDocs.classList.toggle("is-hidden", vis.length>0 || this._docs.length===0);
    },

    async toggleStar(nombre, activa, btn) {
      if(btn) btn.disabled=true;
      try {
        const res=await api.toggle(nombre, activa);
        this._setDocs(res.documentos);
        this.health();
        Toast.info(activa?`"${nombre}" encendida`:`"${nombre}" apagada`);
      } catch(err) {
        Toast.err(`No se pudo cambiar la estrella: ${err.message}`);
      }
    },

    async deleteStar(nombre, btn) {
      if(this.busy) return;
      const ok=await Modal.confirm({
        title:"Eliminar estrella",
        body:`¿Seguro que quieres eliminar <strong>${dom.esc(nombre)}</strong>? Se quita del firmamento y no se puede deshacer.`,
        okText:"Eliminar", tone:"danger",
      });
      if(!ok) return;
      this.busy=true; if(btn) btn.disabled=true;
      Constellation.setState("processing"); Logo.setState("processing");
      try { const res=await api.remove(nombre); this._setDocs(res.documentos); this.health(); Toast.ok(`"${nombre}" eliminada`); }
      catch(err) { Toast.err(`No se pudo eliminar: ${err.message}`); }
      finally { this.busy=false; Constellation.setState("idle"); Logo.setState("idle"); }
    },

    /* ---- carga ---- */
    _upStatus(cls,txt){ this.uploadStatus.hidden=false; this.uploadStatus.className="addctx__status "+cls; this.uploadStatus.textContent=txt; },
    async upload(fileList) {
      if(this.busy) return;
      this.busy=true; this.dropzone.classList.add("is-busy");
      Constellation.setState("processing"); Logo.setState("processing");
      const nombres=[...fileList].map((f)=>f.name).join(", ");
      this._upStatus("busy",`Encendiendo: ${nombres}…`);
      try {
        const res=await api.upload(fileList);
        const ok=res.guardados.map((g)=>g.nombre).join(", ");
        if(res.errores&&res.errores.length) this._upStatus("warn",`Encendida: ${ok}. Omitido: ${res.errores.join(" · ")}`);
        else this._upStatus("ok",`✨ ${ok} · ${res.fragmentos} fragmentos en el firmamento`);
        this._setDocs(res.documentos);
        this.health();
      } catch(err) {
        const extra=err.errores&&err.errores.length?" · "+err.errores.join(" · "):"";
        this._upStatus("err",`Error: ${err.message}${extra}`);
      } finally {
        this.busy=false; this.dropzone.classList.remove("is-busy");
        Constellation.setState("idle"); Logo.setState("idle");
      }
    },

    /* ---- preguntas: la constelacion reacciona al ciclo REAL ---- */
    async ask(text) {
      const q=(text||"").trim();
      if(!q||this.busy) return;
      this.busy=true; this.send.disabled=true; this.input.value="";

      if(!this.started){ this.started=true; this.hero.classList.add("is-hidden"); this.thread.classList.remove("is-hidden"); }

      this.thread.append(Component.UserMsg(q));
      const ai=Component.AiMsg((s)=>Backstage.open(s));
      this.thread.append(ai.node);
      ai.node.scrollIntoView({behavior:"smooth",block:"end"});

      // procesando: la busqueda real empieza AHORA
      Constellation.setState("processing"); Logo.setState("processing");

      try {
        const r=await api.ask(q);
        // respondiendo: convergencia en el momento en que llega la respuesta real
        Constellation.setState("responding"); Logo.setState("responding");
        setTimeout(()=>{ Constellation.setState("idle"); Logo.setState("idle"); }, 1400);
        ai.resolve(r);
      } catch(e) {
        Constellation.setState("idle"); Logo.setState("idle");
        ai.fail(`No se pudo responder: ${e.message}`);
      } finally {
        this.busy=false; this.send.disabled=false; this.input.focus();
        ai.node.scrollIntoView({behavior:"smooth",block:"end"});
      }
    },
  };

  document.addEventListener("DOMContentLoaded",()=>App.boot());
})();
