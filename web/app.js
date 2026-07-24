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
    cfg:{ speedMod:.1, connDist:70, connOp:.03, gravity:0, pulse:.01, converging:false },

    CONFIGS: {
      processing:{ speedMod:1.5, connDist:100, connOp:.15, gravity:.0075, pulse:.05, converging:false },
      responding:{ speedMod:3,   connDist:120, connOp:.4,  gravity:.03,   pulse:.1,  converging:true  },
      listening: { speedMod:.2,  connDist:80,  connOp:.08, gravity:.005,  pulse:.03, converging:false },
      idle:      { speedMod:.1,  connDist:70,  connOp:.03, gravity:0,     pulse:.01, converging:false },
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
        ps.forEach((p)=>{
          if(collapsing){ p.x+=(W/2-p.x)*.05; p.y+=(H/2-p.y)*.05; }
          else { p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1; }
          ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
          ctx.fillStyle=`rgba(140,107,255,${collapsing?.9:.5})`; ctx.fill();
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
    DocCard(doc) {
      const kind = extKind(doc.nombre);
      return dom.el("li",{},[ dom.el("div",{class:"card"},[
        dom.el("div",{class:"card__row"},[
          dom.el("div",{class:`card__ico ${kind}`, html:extIcon(doc.nombre)}),
          dom.el("div",{class:"card__body"},[
            dom.el("div",{class:"card__name",text:doc.nombre,title:doc.nombre}),
            dom.el("div",{class:"card__meta"},[
              dom.el("span",{text:`${doc.fragmentos} frag.`}),
              dom.el("span",{class:"card__ok",html:ICONS.check+"<span>Comprendido</span>"}),
            ]),
          ]),
        ]),
      ])]);
    },
    HeroCard(icon, text, onPick) {
      return dom.el("button",{class:"hero__card",type:"button",onClick:()=>onPick(text)},[
        dom.el("span",{html:icon}), dom.el("span",{text}),
      ]);
    },
    UserMsg(text){ return dom.el("div",{class:"msg msg--user"},[ dom.el("div",{class:"bubble-user",text}) ]); },
    Answer(text){
      const html=dom.esc(text).replace(/\[(\d{1,2})\]/g,'<span class="cite">$1</span>');
      return dom.el("div",{class:"ai__text",html});
    },
    Meta(route,count){
      const cls = route==="tabular" ? "pill pill--tab" : "pill pill--rag";
      const kids=[ dom.el("span",{class:cls,text:ROUTE[route]||route}) ];
      if(count) kids.push(dom.el("span",{text:`${count} fuente${count===1?"":"s"}`}));
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
    Cite(s){
      const body=[ dom.el("div",{class:"cite-row__ref"},[
        document.createTextNode(s.source+" "),
        dom.el("span",{class:"cite-row__loc",text:`· ${s.locator}`}),
      ])];
      if(s.excerpt) body.push(dom.el("p",{class:"cite-row__ex",text:s.excerpt}));
      return dom.el("div",{class:"cite-row"},[
        dom.el("span",{class:"cite-row__n",text:s.n}),
        dom.el("div",{class:"cite-row__body"},body),
        s.score?dom.el("span",{class:"cite-row__score",text:s.score.toFixed(2)}):null,
      ]);
    },
    Cites(sources){
      if(!sources||!sources.length) return null;
      return dom.el("div",{class:"cites"},[ dom.el("p",{class:"cites__t",text:"Fuentes"}), ...sources.map(Component.Cite) ]);
    },
    AiMsg() {
      const logo=dom.el("div",{class:"logo ai__logo",'data-size':"sm"}); logo.innerHTML=dom.svgLogo(); logo.classList.add("logo-processing");
      const content=dom.el("div",{class:"ai__content"},[ dom.el("div",{class:"typing"},[dom.el("span"),dom.el("span"),dom.el("span")]) ]);
      const node=dom.el("div",{class:"msg msg--ai"},[ dom.el("div",{class:"ai"},[logo,content]) ]);
      return {
        node, logo, content,
        resolve(r){
          logo.classList.remove("logo-processing"); logo.classList.add("logo-responding");
          dom.clear(content);
          content.append(Component.Meta(r.route,(r.sources||[]).length));
          content.append(Component.Answer(r.answer));
          const t=Component.Table(r.table); if(t) content.append(t);
          const c=Component.Cites(r.sources); if(c) content.append(c);
        },
        fail(msg){ logo.classList.remove("logo-processing"); dom.clear(content); content.append(dom.el("div",{class:"err-box",text:msg})); },
      };
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
      this.fileInput=document.getElementById("fileInput");
      this.uploadStatus=document.getElementById("uploadStatus");
      this.docList=document.getElementById("docList");
      this.sysStat=document.getElementById("sysStat");
      this.sideDot=document.querySelector(".side__dot");
    },

    _wire() {
      this.form.addEventListener("submit",(e)=>{ e.preventDefault(); this.ask(this.input.value); });
      // carga de archivos
      this.dropzone.addEventListener("click",()=>this.fileInput.click());
      this.dropzone.addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();this.fileInput.click();} });
      this.fileInput.addEventListener("change",()=>{ if(this.fileInput.files.length) this.upload(this.fileInput.files); this.fileInput.value=""; });
      ["dragenter","dragover"].forEach((ev)=>this.dropzone.addEventListener(ev,(e)=>{e.preventDefault();this.dropzone.classList.add("is-drag");}));
      ["dragleave","drop"].forEach((ev)=>this.dropzone.addEventListener(ev,(e)=>{e.preventDefault();this.dropzone.classList.remove("is-drag");}));
      this.dropzone.addEventListener("drop",(e)=>{ const f=e.dataTransfer.files; if(f&&f.length) this.upload(f); });
    },

    _renderHero() {
      dom.clear(this.heroCards);
      HERO_CARDS.forEach(([icon,text])=>this.heroCards.append(Component.HeroCard(icon,text,(t)=>this.ask(SUG[t]||t))));
    },

    async health() {
      try { const s=await api.health(); this.sysStat.textContent=`${s.chunks} fragmentos · ${s.llm}`; }
      catch { this.sysStat.textContent="sin conexión"; this.sideDot.classList.add("is-err"); }
    },

    async refreshDocs() {
      try {
        const { documents }=await api.documents();
        dom.clear(this.docList);
        documents.forEach((d)=>this.docList.append(Component.DocCard(d)));
        Constellation.setDocs(documents.length);
      } catch {/* no critico */}
    },

    /* ---- carga ---- */
    _upStatus(cls,txt){ this.uploadStatus.hidden=false; this.uploadStatus.className="addctx__status "+cls; this.uploadStatus.textContent=txt; },
    async upload(fileList) {
      if(this.busy) return;
      this.busy=true; this.dropzone.classList.add("is-busy");
      Constellation.setState("processing"); Logo.setState("processing");
      const nombres=[...fileList].map((f)=>f.name).join(", ");
      this._upStatus("busy",`Comprendiendo: ${nombres}…`);
      try {
        const res=await api.upload(fileList);
        const ok=res.guardados.map((g)=>g.nombre).join(", ");
        if(res.errores&&res.errores.length) this._upStatus("warn",`Añadido: ${ok}. Omitido: ${res.errores.join(" · ")}`);
        else this._upStatus("ok",`✓ ${ok} · ${res.fragmentos} fragmentos en total`);
        dom.clear(this.docList);
        res.documentos.forEach((d)=>this.docList.append(Component.DocCard(d)));
        Constellation.setDocs(res.documentos.length);
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
      const ai=Component.AiMsg();
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
