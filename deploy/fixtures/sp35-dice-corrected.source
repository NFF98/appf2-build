const app = document.getElementById('app');
app.innerHTML = `
  <style>
    .dice-game-container {
      max-width: 400px;
      margin: 40px auto;
      background: #fffbe8;
      border-radius: 18px;
      box-shadow: 0 4px 24px #0001;
      padding: 32px 24px 24px 24px;
      font-family: 'Microsoft JhengHei', sans-serif;
      text-align: center;
    }
    .dice-title {
      font-size: 2rem;
      font-weight: bold;
      color: #d18b00;
      margin-bottom: 12px;
      letter-spacing: 2px;
    }
    .dice-row {
      display: flex;
      justify-content: center;
      gap: 18px;
      margin: 24px 0 12px 0;
    }
    .dice {
      width: 54px;
      height: 54px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 8px #0002;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.2rem;
      position: relative;
      transition: transform 0.2s cubic-bezier(.4,2,.6,1), box-shadow 0.2s;
      border: 2px solid #f5d06f;
    }
    .dice.rolling {
      animation: dice-roll 0.5s cubic-bezier(.4,2,.6,1) infinite alternate;
      box-shadow: 0 4px 16px #d18b0033;
      background: #fffbe8;
    }
    @keyframes dice-roll {
      0% { transform: rotate(-10deg) scale(1.05); }
      100% { transform: rotate(10deg) scale(0.95); }
    }
    .dice-dot {
      width: 10px;
      height: 10px;
      background: #d18b00;
      border-radius: 50%;
      position: absolute;
    }
    .dice-btns {
      margin: 18px 0 8px 0;
      display: flex;
      justify-content: center;
      gap: 18px;
    }
    .dice-btn {
      background: linear-gradient(90deg,#ffd700,#ffb300);
      color: #fff;
      font-size: 1.1rem;
      font-weight: bold;
      border: none;
      border-radius: 8px;
      padding: 10px 28px;
      cursor: pointer;
      box-shadow: 0 2px 8px #d18b0033;
      transition: background 0.2s, box-shadow 0.2s;
    }
    .dice-btn:active {
      background: linear-gradient(90deg,#ffb300,#ffd700);
      box-shadow: 0 1px 4px #d18b0033;
    }
    .dice-result {
      font-size: 1.2rem;
      color: #d18b00;
      margin: 10px 0 0 0;
      min-height: 32px;
      font-weight: bold;
    }
    .dice-score {
      font-size: 1.1rem;
      color: #555;
      margin-top: 8px;
    }
  </style>
  <div class="dice-game-container">
    <div class="dice-title">十八啦骰子遊戲</div>
    <div class="dice-row" id="dice-row"></div>
    <div class="dice-btns">
      <button class="dice-btn" id="roll-btn">擲骰子</button>
      <button class="dice-btn" id="reset-btn">重新開始</button>
    </div>
    <div class="dice-result" id="dice-result"></div>
    <div class="dice-score" id="dice-score"></div>
  </div>
`;


app.insertAdjacentHTML('afterbegin',`
<style>
 .game-tabs{max-width:500px;margin:20px auto;display:grid;grid-template-columns:repeat(4,1fr);gap:7px;font-family:'Microsoft JhengHei',sans-serif}
 .game-tabs button{padding:10px 3px;border-radius:11px;background:#fffaf0;color:#795300;border:1px solid #dab659;font-weight:700;cursor:pointer}
 .game-tabs button[aria-pressed="true"]{background:#b07c10;color:white}
 .game-view{max-width:480px;margin:18px auto;padding:20px;border:1px solid #efdca5;border-radius:18px;background:#fffcf4;font-family:'Microsoft JhengHei',sans-serif;color:#5e4409}
 .game-view[hidden]{display:none!important}
 .game-view h2{font-size:20px}.game-view li{margin:10px 0}
 .game-line{padding:10px 0;border-bottom:1px solid #efdfac}
 .game-next{background:#b07c10;color:#fff;border:0;border-radius:8px;padding:12px 16px;font-weight:bold;cursor:pointer}
 .game-turn{color:#806016;margin:10px 0;font-weight:bold}
 .dice-game-container[hidden]{display:none!important}
 .dice-dot{width:10px!important;height:10px!important}
 @media(max-width:500px){.dice-game-container{padding:16px 10px!important}.dice-row{gap:8px!important}.game-tabs{gap:3px}.game-tabs button{font-size:13px}}
</style>
<nav class="game-tabs" aria-label="遊戲頁面">
 <button type="button" data-page="遊戲" aria-pressed="true">遊戲</button>
 <button type="button" data-page="結果" aria-pressed="false">結果</button>
 <button type="button" data-page="排行" aria-pressed="false">排行</button>
 <button type="button" data-page="規則" aria-pressed="false">規則</button>
</nav>`);
app.querySelector('.dice-game-container').id='view-game';
app.insertAdjacentHTML('beforeend',`
<section id="view-results" class="game-view" hidden><h2>本回合結果</h2><div id="game-winner"></div><div id="game-results"></div><button class="game-next" type="button" id="game-next" hidden>開始下一回合</button></section>
<section id="view-ranking" class="game-view" hidden><h2>累積排行榜</h2><div id="game-ranking"></div></section>
<section id="view-rules" class="game-view" hidden><h2>十八啦規則</h2>
 <ol><li>四顆骰子全部相同是一色（豹子），為最高牌型。</li>
 <li>兩對取點數較大的那一對相加，例如 2-2-6-6 得 12 點，叫十八啦。</li>
 <li>只有一對時，去掉那一對，其餘兩顆相加。</li>
 <li>三顆相同或四顆皆不同是無點，請重新擲骰、不換人、不計分。</li>
 <li>兩位玩家輪流擲出有效骰型，依牌型與點數決定勝負；每回合勝者加一勝。</li>
 </ol><p>採此版本所列桌規；地方玩法可能不同。</p></section>`);
app.querySelector('.dice-score').insertAdjacentHTML('afterend','<div id="game-turn" class="game-turn" aria-live="polite"></div>');

const diceRow = document.getElementById('dice-row');
const rollBtn = document.getElementById('roll-btn');
const resetBtn = document.getElementById('reset-btn');
const resultDiv = document.getElementById('dice-result');
const scoreDiv = document.getElementById('dice-score');

let dice = [1,1,1,1];
let rolling = false;
let totalScore = 0;
let round = 1;
let turn = 0;
let players=[{name:'玩家一',wins:0,points:0,rolls:0},{name:'玩家二',wins:0,points:0,rolls:0}];
let roundResults=[];
let roundFinished=false;
function showPage(name){
 for(const b of app.querySelectorAll('[data-page]'))b.setAttribute('aria-pressed',String(b.dataset.page===name));
 document.getElementById('view-game').hidden=name!=='遊戲';
 document.getElementById('view-results').hidden=name!=='結果';
 document.getElementById('view-ranking').hidden=name!=='排行';
 document.getElementById('view-rules').hidden=name!=='規則';
}
function drawGame(){
 document.getElementById('game-turn').textContent=roundFinished?
  '第 '+round+' 回合已完成，查看勝負並開始下一回合':
  '第 '+round+' 回合 · 輪到 '+players[turn].name+' 擲骰';
 document.getElementById('game-ranking').innerHTML=players.map(p=>({ ...p }))
  .sort((a,b)=>b.wins-a.wins||b.points-a.points)
  .map((p,i)=>'<div class="game-line">#'+(i+1)+' '+p.name+'　'+p.wins+' 勝　有效擲骰 '+p.rolls+' 次　累積 '+p.points+' 點</div>').join('');
 document.getElementById('game-results').innerHTML=roundResults.map(x=>
   '<div class="game-line">'+x.name+'　'+x.text+'　牌力 '+x.power+'</div>').join('') || '尚無本回合結果';
 document.getElementById('game-next').hidden=!roundFinished;
 rollBtn.disabled=rolling||roundFinished;
}
for(const b of app.querySelectorAll('[data-page]'))b.addEventListener('click',()=>showPage(b.dataset.page));
document.getElementById('game-next').addEventListener('click',()=>{
 if(!roundFinished||rolling)return;
 round++;turn=0;roundResults=[];roundFinished=false;totalScore=0;
 resultDiv.textContent='';scoreDiv.textContent='';
 renderDice([1,1,1,1]);drawGame();showPage('遊戲');
});

function renderDice(diceArr, animating=false) {
  diceRow.innerHTML = '';
  for(let i=0;i<4;i++) {
    const d = document.createElement('div');
    d.className = 'dice';
    if(animating) d.classList.add('rolling');
    renderDiceFace(d, diceArr[i]);
    diceRow.appendChild(d);
  }
}

function renderDiceFace(diceDiv, num) {
  diceDiv.innerHTML = '';
  // Dot positions for 1-6
  const dotPos = [
    [],
    [[1,1]],
    [[0,0],[2,2]],
    [[0,0],[1,1],[2,2]],
    [[0,0],[0,2],[2,0],[2,2]],
    [[0,0],[0,2],[1,1],[2,0],[2,2]],
    [[0,0],[0,2],[1,0],[1,2],[2,0],[2,2]]
  ];
  const size = 54, gap = 4;
  dotPos[num].forEach(([r,c])=>{
    const dot = document.createElement('div');
    dot.className = 'dice-dot';
    dot.style.left = (gap + c*16) + 'px';
    dot.style.top = (gap + r*16) + 'px';
    diceDiv.appendChild(dot);
  });
}

function randomDice() {
  return Math.floor(Math.random()*6)+1;
}

function sleep(ms) {
  return new Promise(r=>setTimeout(r,ms));
}

function eighteenlaRule(diceArr) {
 if(!Array.isArray(diceArr)||diceArr.length!==4||!diceArr.every(n=>Number.isInteger(n)&&n>=1&&n<=6))
   throw Error('NEED_FOUR_DICE');
 const counts=new Map();
 for(const n of diceArr)counts.set(n,(counts.get(n)||0)+1);
 const group=[...counts.entries()];
 if(group.length===1){const face=diceArr[0];return {text:'一色／豹子 '+face,score:18,valid:true,power:100+face};}
 if(group.some(([,count])=>count===3))
   return {text:'三同一異：無點，請重擲',score:0,valid:false,power:0};
 const pair=group.filter(([,count])=>count===2).map(([n])=>n);
 if(pair.length===2){const sum=2*Math.max(...pair);
   return {text:'兩對：'+sum+' 點'+(sum===12?'（十八啦！）':''),score:sum,valid:true,power:sum};}
 if(pair.length===1){const score=diceArr.filter(n=>n!==pair[0]).reduce((sum,n)=>sum+n,0);
   return {text:'一對：'+score+' 點'+(score===3?'（逼機）':''),score,valid:true,power:score};}
 return {text:'沒有對子：無點，請重擲',score:0,valid:false,power:0};
}

function updateResult() {
 const {text,score,valid,power}=eighteenlaRule(dice);
 resultDiv.textContent=text;
 if(!valid){scoreDiv.textContent='無效骰型，本次不計分。';drawGame();return;}
 const player=players[turn];player.rolls++;
 if(power<100)player.points+=score;
 totalScore+=score;
 roundResults.push({name:player.name,text,power});
 scoreDiv.textContent='本局得分：'+score+' 分 ｜ '+player.name+' 累積：'+player.points+' 分';
 if(roundResults.length===players.length){
  roundFinished=true;
  const best=Math.max(...roundResults.map(r=>r.power));
  for(const r of roundResults.filter(r=>r.power===best)){
   const winner=players.find(p=>p.name===r.name);if(winner)winner.wins++;
  }
  document.getElementById('game-winner').textContent='本回合勝出：'+
   roundResults.filter(r=>r.power===best).map(r=>r.name).join('、');
  drawGame();showPage('結果');
 }else{turn++;drawGame();}
}

async function rollDiceAnim() {
  if(rolling) return;
  rolling = true;
  rollBtn.disabled = true;
  let animTimes = 12;
  for(let i=0;i<animTimes;i++) {
    let temp = [randomDice(),randomDice(),randomDice(),randomDice()];
    renderDice(temp,true);
    await sleep(40+10*i);
  }
  dice = [randomDice(),randomDice(),randomDice(),randomDice()];
  renderDice(dice,false);
  updateResult();
  rolling = false;
  rollBtn.disabled = false;
}

function resetGame() {
 if(rolling)return;
 dice=[1,1,1,1];totalScore=0;round=1;turn=0;roundResults=[];roundFinished=false;
 players=players.map(p=>({...p,wins:0,points:0,rolls:0}));
 renderDice(dice,false);resultDiv.textContent='';scoreDiv.textContent='';
 document.getElementById('game-winner').textContent='';
 drawGame();showPage('遊戲');
}

rollBtn.addEventListener('click', rollDiceAnim);
resetBtn.addEventListener('click', resetGame);

renderDice(dice,false);
drawGame();
