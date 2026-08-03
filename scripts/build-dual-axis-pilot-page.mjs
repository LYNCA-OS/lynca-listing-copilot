#!/usr/bin/env node
// Render the dual-axis ballot as a self-contained page the reviewer can fill
// while looking at the card.
//
// The CSV is the record format; a spreadsheet next to a folder of signed URLs
// is not something anyone will actually complete carefully. This puts the two
// images and the questions about them in one place, and exports the same CSV.
//
// Blindness is preserved: the page carries images and candidate terms only --
// no reference title, no system title, no scores, and no indication of which
// candidate the pipeline kept.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = process.argv[2] || "artifacts/dual-axis-pilot";
const cards = readFileSync(resolve(dir, "ballot.jsonl"), "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l));

const VERDICT = ["OK_TO_JUDGE", "WRONG_FIELD", "WRONG_GRANULARITY", "TERM_UNKNOWN", "OTHER"];
const TRUTH = ["SUPPORTED", "CONTRADICTED", "UNKNOWN"];
const SOURCE = ["CARD_IMAGE", "SLAB_LABEL", "OFFICIAL_SOURCE"];
const POLICY = ["REQUIRED", "OPTIONAL", "FORBIDDEN", "NOT_APPLICABLE"];
const REASON = ["PRODUCT_BASE_APPEARANCE", "NAMES_THE_PARALLEL", "WRITER_CONVENTION", "REDUNDANT", "OTHER"];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sel = (name, opts, cls = "") => `<select data-f="${name}" class="${cls}"><option value=""></option>`
  + opts.map((o) => `<option>${o}</option>`).join("") + `</select>`;

const body = cards.map((card, i) => {
  const front = card.images.find((im) => /front/.test(im.role))?.url || "";
  const back = card.images.find((im) => /back/.test(im.role))?.url || "";
  const claims = card.claims.map((claim, j) => `
    <div class="claim" data-card="${i}" data-claim="${j}" data-value="${esc(claim.value)}">
      <div class="term">${esc(claim.value)}</div>
      <div class="fields">
        <label>这条判断成不成立 ${sel("claim_verdict", VERDICT, "wide")}</label>
        <label>卡上是不是这样 ${sel("truth_status", TRUTH)}</label>
        <label>依据来源 ${sel("truth_source", SOURCE)}</label>
        <label>该不该进标题 ${sel("title_policy", POLICY)}</label>
        <label class="key">为什么（最重要） ${sel("policy_reason", REASON, "wide")}</label>
        <label class="grow">证据位置 <input data-f="evidence_refs" placeholder="正面右下 / 评级标签 / 来源"></label>
        <label class="grow">备注 <input data-f="note" placeholder="选项表达不了的情况写这里"></label>
      </div>
    </div>`).join("");
  return `
  <section class="card" data-card="${i}" data-asset="${esc(card.asset_id)}">
    <header><span class="idx">${i + 1} / ${cards.length}</span><code>${esc(card.asset_id.slice(-12))}</code></header>
    <div class="imgs">
      <a href="${esc(front)}" target="_blank"><img loading="lazy" src="${esc(front)}" alt="正面"></a>
      <a href="${esc(back)}" target="_blank"><img loading="lazy" src="${esc(back)}" alt="反面"></a>
    </div>
    <div class="claims">${claims}</div>
    <div class="scan">
      <label class="grow key">这张卡的工艺/平行版<b>实际上</b>是什么（不用管上面列的）
        <input data-f="what_this_cards_finish_actually_is" placeholder="直接写正确答案；上面全不对时这格就是答案"></label>
      <label class="grow">上面没列、但你看到的其他工艺词
        <input data-f="finish_terms_not_listed_above"></label>
      <label class="grow">这张卡还有什么<b>必须</b>进标题的信息
        <input data-f="other_required_facts"></label>
    </div>
  </section>`;
}).join("");

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>双轴标注 pilot — ${cards.length} 张</title><style>
:root{--bg:#fff;--fg:#111;--mut:#666;--line:#e3e3e3;--card:#fafafa;--key:#fff8e1;--keyline:#e6c200}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e8e8;--mut:#9aa0a6;--line:#2c3038;--card:#1b1e24;--key:#2a2410;--keyline:#7a6a10}}
*{box-sizing:border-box}body{margin:0;padding:0 0 6rem;background:var(--bg);color:var(--fg);
font:15px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif}
.top{position:sticky;top:0;z-index:9;background:var(--bg);border-bottom:1px solid var(--line);padding:.9rem 1.2rem;
display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
.top h1{font-size:1rem;margin:0;font-weight:600}.top .prog{color:var(--mut);font-size:.85rem}
button{font:inherit;padding:.45rem .9rem;border:1px solid var(--line);border-radius:7px;background:var(--card);
color:var(--fg);cursor:pointer}button.primary{background:#2563eb;color:#fff;border-color:#2563eb}
.note{padding:1rem 1.2rem;color:var(--mut);max-width:62rem;font-size:.9rem}
.note b{color:var(--fg)}
section.card{border-top:1px solid var(--line);padding:1.4rem 1.2rem;max-width:78rem}
header{display:flex;gap:.8rem;align-items:baseline;margin-bottom:.8rem}
.idx{font-weight:600}code{color:var(--mut);font-size:.8rem}
.imgs{display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem}
.imgs img{max-width:min(360px,44vw);max-height:460px;border-radius:9px;border:1px solid var(--line);display:block}
.claim{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:.8rem 1rem;margin-bottom:.7rem}
.term{font-weight:700;font-size:1.05rem;margin-bottom:.55rem}
.fields{display:flex;flex-wrap:wrap;gap:.55rem 1rem}
label{display:flex;flex-direction:column;gap:.25rem;font-size:.8rem;color:var(--mut)}
label.grow{flex:1 1 15rem}label.key{background:var(--key);border:1px solid var(--keyline);border-radius:6px;padding:.3rem .5rem}
select,input{font:inherit;font-size:.85rem;padding:.32rem .4rem;border:1px solid var(--line);border-radius:6px;
background:var(--bg);color:var(--fg)}select.wide{min-width:13rem}input{width:100%}
.scan{display:flex;flex-wrap:wrap;gap:.6rem 1rem;padding:.8rem 1rem;border:1px dashed var(--line);border-radius:9px}
.done{opacity:.5}
</style></head><body>
<div class="top"><h1>双轴标注 pilot</h1><span class="prog" id="prog"></span>
<button class="primary" id="dl">导出 CSV</button><button id="save">存进度</button><button id="load">读进度</button></div>
<div class="note">
<b>这是试跑，结果不计入任何结论。</b> 我们要检验的是这张表本身够不够用。<br>
如果哪一条你觉得给的选项没一个对，就选 <b>WRONG_FIELD / WRONG_GRANULARITY / TERM_UNKNOWN</b>，或者写进备注。
<b>选「都不对」是成功结果，不是没做完。</b> 判断不了就填 UNKNOWN，不要猜。<br>
两根轴请分开判断：<b>一个词完全可以「是真的」并且「不该写进标题」。</b>
黄色那格（为什么）比「该不该进标题」本身更重要——它决定我们是该建产品目录，还是该保留这根轴。
</div>
${body}
<script>
const cards=${JSON.stringify(cards.map((c) => ({ asset_id: c.asset_id, claims: c.claims.map((x) => x.value) })))};
const CF=["claim_verdict","truth_status","truth_source","title_policy","policy_reason","evidence_refs","note"];
const SF=["what_this_cards_finish_actually_is","finish_terms_not_listed_above","other_required_facts"];
const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>[...r.querySelectorAll(s)];
function collect(){return qa("section.card").map(sec=>({
 asset_id:sec.dataset.asset,
 claims:qa(".claim",sec).map(c=>{const o={value:c.dataset.value};CF.forEach(f=>o[f]=(q('[data-f="'+f+'"]',c)||{}).value||"");return o}),
 scan:Object.fromEntries(SF.map(f=>[f,(q('[data-f="'+f+'"]',sec)||{}).value||""]))}))}
function prog(){const t=qa(".claim").length;let d=0;
 qa("section.card").forEach(sec=>qa(".claim",sec).forEach(c=>{const v=q('[data-f="claim_verdict"]',c).value;
  const done=v&&(v!=="OK_TO_JUDGE"||q('[data-f="truth_status"]',c).value);
  c.classList.toggle("done",!!done);if(done)d++}));
 q("#prog").textContent=d+" / "+t+" 条已填";}
document.addEventListener("change",prog);document.addEventListener("input",()=>{try{localStorage.setItem("pilot",JSON.stringify(collect()))}catch(e){}});
function csv(){const head=["asset_id","claim_value",...CF].join(",");
 const rows=collect().flatMap(c=>c.claims.map(cl=>[c.asset_id,cl.value,...CF.map(f=>cl[f])]
  .map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")));
 const head2=["asset_id",...SF].join(",");
 const rows2=collect().map(c=>[c.asset_id,...SF.map(f=>c.scan[f])].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(","));
 return head+"\\n"+rows.join("\\n")+"\\n\\n"+head2+"\\n"+rows2.join("\\n")+"\\n";}
q("#dl").onclick=()=>{const b=new Blob([csv()],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");
 a.href=URL.createObjectURL(b);a.download="dual-axis-pilot-filled.csv";a.click()};
q("#save").onclick=()=>{localStorage.setItem("pilot",JSON.stringify(collect()));alert("已存到浏览器本地")};
q("#load").onclick=()=>{const raw=localStorage.getItem("pilot");if(!raw)return alert("没有已存进度");
 const data=JSON.parse(raw);qa("section.card").forEach((sec,i)=>{const d=data[i];if(!d)return;
  qa(".claim",sec).forEach((c,j)=>{const cl=d.claims[j];if(!cl)return;CF.forEach(f=>{const el=q('[data-f="'+f+'"]',c);if(el)el.value=cl[f]||""})});
  SF.forEach(f=>{const el=q('[data-f="'+f+'"]',sec);if(el)el.value=(d.scan||{})[f]||""})});prog()};
try{if(localStorage.getItem("pilot"))q("#load").click()}catch(e){}
prog();
</script></body></html>`;
writeFileSync(resolve(dir, "pilot.html"), html);
process.stdout.write(`${cards.length} 张 / ${cards.reduce((s, c) => s + c.claims.length, 0)} 条 -> ${resolve(dir, "pilot.html")}\n`);
