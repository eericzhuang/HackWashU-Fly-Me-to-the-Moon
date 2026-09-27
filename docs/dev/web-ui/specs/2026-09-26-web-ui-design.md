# Terminator Web UI 设计：「低太阳 / Low Sun」

- 日期：2026-09-26
- 分支：`ui`（从 `hardware` 拉出）
- 范围：网页 UI、手写识别（Google Vision）、朗读（Google Cloud TTS）。硬件、拍摄和图像处理归 Eric，这份设计不改他的代码和接口。
- 状态：设计已逐节确认，等待书面审阅

---

## 1. 目标

把 `terminator.phone` 那大约 90 秒的扫描变成一场连续的电影式演出。画面直接演出项目原理：满月时月面是平的，就像那张"空白"的纸；太阳贴着晨昏线斜照时，环形山拖出长影，就像凹痕在低角度的 LED 光下显出字迹。揭晓之后，AI 用"来自月球的无线电"把信息读出来，评委还可以自己拖动太阳，亲手体验这个原理。

**成功标准**

1. 整场演出只靠 `out/latest/meta.json` 推进。演示者双手在按快门，不需要碰电脑。
2. 状态变成 `done` 之后，15 秒内揭晓图清晰地出现在屏幕上并开始朗读。识别失败时，揭晓图照样出现。
3. 除了调用 Google，其余全部离线可用：库、贴图、字体、声音都存进仓库。
4. 在演示用的 Mac 上跑满 60 fps。
5. 画面质量明显高于分镜草稿，具体标准见第 4 节。

**不做的事**

- 不重做 Eric 的原理讲解翻页（`terminator/viewer.py`），它继续负责评委追问时的技术深挖。这一条待和 Eric 确认，见第 11 节。
- 不改扫描文件夹的接口约定，不写入 `out/`。

---

## 2. 影响设计的约束

| 约束 | 来源 | 对设计的影响 |
|---|---|---|
| 真实流程约 90 秒：拍四张约 76 秒，每张都要手动按快门并等夜间模式曝光；对齐合成约 17 秒 | CLAUDE.md 状态记录 | UI 的主要任务是把等待变成演出；合成那一幕的时长不固定 |
| 屏幕本身是光源：从高处来的非掠射光会冲淡凹痕 | 和 Eric 记录的"LED 竖着放会冲掉凹痕"同理 | 拍摄阶段给画面亮度设上限（`captureMaxLuma`，默认 0.35，彩排时调），到揭晓才"日出" |
| 演示者双手忙，房间是黑的 | 演示流程 | 全自动推进，只留少量键盘快捷键 |
| 浏览器不允许在用户操作前自动放声音 | 浏览器自动播放策略 | 开场先按任意键"启用声音"，待机画面上有一行小字提示 |
| `out/latest` 里的文件会原子替换，而且 `meta.json` 最后写；旧扫描的文件会留着，直到被覆盖 | 接口约定 | 只相信 `meta.json`；图片地址带版本号，防止拿到旧缓存 |
| 手机方案在拍摄中写的是未对齐的预览图，`done` 时才换成对齐后的 | 接口约定 | 进入 `done` 时，四张图全部按新版本号重新加载 |
| 演示机是 Eric 的 Mac（`phone.py` 依赖 macOS），开发在 Windows | 团队环境 | 纯浏览器方案，跨平台；Mac 上要装一次 Node |

---

## 3. 体验：六幕

LED 编号、方向、虚拟太阳位置和和弦的对应关系：

| LED | 方向 | 虚拟太阳在屏幕的 | 和弦 |
|---|---|---|---|
| 0 | north | 上方 | Em7 |
| 1 | east | 右侧 | Am7 |
| 2 | south | 下方 | Dm7 |
| 3 | west | 左侧 | G7 |

这是 iii–vi–ii–V 的五度圈进行，最后在揭晓时解决到 I（Cmaj9）。

### 第 1 幕：待机（时长不限）
- **画面**：一颗 3D 月球处于满月状态，缓慢自转。在正确的月面着色下，它看起来是平的，没有细节。背景是真实星空，左上角是很淡的 `TERMINATOR` 字样。
- **文案**：`Write a secret. Tear off the page.`，下方小字 `FULL MOON · NO SHADOWS · THE PAGE LOOKS BLANK`。声音还没启用时，再加一行 `press any key to arm audio`。
- **声音**：很低的 C 持续音，加上滤过的"太阳风"噪声。

### 第 2 幕：拍摄 ×4（约 76 秒）
- **触发**：出现新扫描（`started` 变了），或者 `captured` 数量增加。
- **画面**：
  - 太阳用约 1.5 秒平滑转到当前 LED 所在的一侧，月球变成那个朝向的半月，晨昏线穿过月面中央，环形山拖出长影。
  - 屏幕靠近当前 LED 的那条边泛起很淡的绿光，和房间里真实的 LED 颜色呼应。
  - 照片落地时（布局选 A）：先在中间放大停 2 秒。这时亮度受 `captureMaxLuma` 限制，但字迹看得清。然后用 0.8 秒缩成一张薄卡片，飞到月球旁对应的方位停下。
- **演示者提示**（左下角）：`SHOT 2 / 4` 和 `East light on — tap the shutter`。照片落地后短暂显示 `Got shot 2`。
- **进度**（右下角）：N、E、S、W 四个点，当前那个在呼吸闪烁。
- **声音**：LED 亮起时换到对应的和弦，照片落地时响一声 Rhodes 风格的电钢琴音。

### 第 3 幕：合成（时长不固定，约 17 秒）
- **触发**：四张都到了，但状态还是 `capturing`。
- **画面**：太阳绕月循环旋转（约 8 秒一圈），晨昏线跟着转。前 6 秒里，四张卡片沿螺旋线落进月球。之后镜头缓慢推近，速度越来越慢，能一直撑到 `done` 到来。右上角显示 `COMBINING`。
- **声音**：悬在 G7 上，滤波器慢慢打开，低频脉冲逐渐变快。

### 第 4 幕：降落（约 4 秒）
- **触发**：状态变成 `done`。这时后台立刻发出识别请求，和动画并行。
- **画面**：镜头俯冲到晨昏线附近的月面，月面材质渐变成这张纸的地形（由真实数据生成，见 4.2 节）。太阳压在 10°（大约是 Apollo 11 着陆时的太阳高度），字迹像月面上的脚印一样投出长影。
- **声音**：低频轰鸣渐强。

### 第 5 幕：日出和朗读（约 8 秒）
- **画面**：镜头拉到俯视，画面整体变亮，纸面渐变成干净的 `reveal.png`，占满画面中央。
- **朗读**：先放一段 Quindar 音，无线电语音逐词读出，读到哪个词，那个词的框就亮一下；读完再放一段 Quindar 音。底部字幕用大写、字距加宽，当前的词用金色。
- **失败路径**：见第 7 节。
- **声音**：解决到 Cmaj9。朗读时配乐自动压低。

### 第 6 幕：握住太阳（直到下一次扫描）
- **画面**：纸面用四张真实照片实时重新打光。鼠标拖动环形刻度上的太阳可以改变方位，拖动右侧滑杆可以改变高度（10° 到 90°）。太阳升到正午，字就消失；压低，字又出现。
- **提示**：`HOLD THE SUN · drag the light`。
- **声音**：和弦一直延续。太阳越低，音色越暗越暖；方位决定左右声像。
- 新扫描一开始，就自动打断当前画面，进入第 2 幕。

### 键盘

| 键 | 作用 |
|---|---|
| 任意键（第一次） | 启用声音 |
| Space | 跳过当前动画，直接到这一段的结束状态 |
| R | 重播最近一次扫描 |
| Esc | 回到待机 |
| M | 静音 |
| F | 全屏 |
| D | 打开调光台（开发用） |

---

## 4. 渲染与美术标准

### 4.1 月球
- **数据**：NASA SVS 的 CGI Moon Kit。LRO 彩色图用 4K 作颜色，LOLA 高程图用 2K，由它生成法线和位移。全部存进 `web/public/assets/moon/`。
- **着色**：自写 `ShaderMaterial`，使用 Lommel–Seeliger 反射：`L ∝ albedo · μ₀ / (μ₀ + μ)`，再加一点对冲效应（opposition surge）。这样满月才是平的，没有球体那种明暗过渡；第 1 幕的叙事靠它才站得住。
- **长影**：在片元着色器里，沿太阳方向对高程图做光线步进（32–48 步），算出真正的投影。晨昏线附近的长影是整个主题的核心画面。
- **暗面**：约 1% 的偏蓝环境光，模拟地照，所以暗面不是死黑。
- **太阳换方向**：方向向量做球面插值，约 1.5 秒，晨昏线是扫过去的。

### 4.2 纸面地形（第 4 幕、第 6 幕）
- **高度**：`h = blur(1 − reveal/255, σ≈1.5px) × 深度系数`。
- **微观法线**：由四张对齐后的照片算出：
  - 先做平场：`R_k = I_k / blur(I_k)`，用 GPU 的可分离高斯模糊，σ 和 reveal.py 一样取 40 px；
  - 再算法线：`n = normalize(g·(R_W − R_E), g·(R_N − R_S), 1)`，g 是可调的夸张系数。
- **影子**：同样在高度图里沿太阳方向做光线步进。
- **月面到纸面的渐变**：同一个着色器里用一个参数 `morph` 从 0 到 1，颜色、法线和高度同时插值。
- **握住太阳**：`shade = albedo · (ambient + max(0, n·L))`，其中 `albedo = mean(I_k)`。太阳在 90° 时，`n·L` 在平纸和凹痕上几乎一样，字自然就消失了。如果真实数据算出的法线太噪，就退回按方位角混合四张照片的方案（类似 RTI），高度只调对比度。

### 4.3 后期和质感
- HDR 渲染，ACES 电影色调映射。
- 使用 `postprocessing`（pmndrs）：太阳和晨昏线高光上的 bloom、SMAA 抗锯齿、暗角、很轻的胶片颗粒。
- 拍摄阶段的亮度上限在最后一道后期里执行：`captureMaxLuma`。
- **星空**：Yale 亮星星表（约 9100 颗），按星等决定亮度、按 B−V 色指数决定颜色，用点精灵渲染。
- **照片卡片**：有厚度的薄盒子，边缘有一点镜面反光，正面贴照片。

### 4.4 文字和动效
- 所有界面文字都用 HTML 叠加层，不画进 WebGL。
- **字体**：Jost（OFL 许可，Futura 风格；Futura 是 Apollo 11 铭牌上的字体），数字和遥测用 JetBrains Mono（OFL）。字体文件存进仓库。
- 所有运动都有缓动，不用线性运动。镜头带弹簧惯性，拖动太阳时也有惯性。用 GSAP 时间线编排。
- 按 16:9 设计，重要元素留安全边距，16:10 的 Mac 屏幕也能正常显示。

### 4.5 性能
- 目标是在 Eric 的 Mac 上跑满 60 fps。像素比按帧率动态调整，范围在 1 到 devicePixelRatio 之间。
- 调光台里有质量档位：光线步进步数、bloom 分辨率。

### 4.6 调光台（开发用，按 D 打开）
- 用 lil-gui 做面板，可以调：太阳方位和高度、曝光、bloom、`captureMaxLuma`、地形深度、法线夸张系数、光线步进步数。
- 可以跳到任意一幕，可以切换数据源。
- 有一个"清空识别缓存"按钮。

---

## 5. 架构

### 5.1 技术选型
- **前端**：Vite + TypeScript + three.js。另外用到 `postprocessing`、`gsap`、`tone`，开发时还用 `lil-gui`。
- **后端**：一个 Vite 插件（Node）。它同时挂在开发服务器（`vite`）和预览服务器（`vite preview`）上，不单独起 Python 服务。
- 3D 需要的高度图和法线在浏览器里用 GPU 计算，所以 Eric 的 Python 代码不用改。

### 5.2 目录
```
web/
  package.json  tsconfig.json  vite.config.ts
  .env.local                 # GOOGLE_API_KEY=...（已 gitignore）
  server/
    plugin.ts                # 在 dev 和 preview 服务器上注册中间件
    scans.ts                 # GET /scan/:name/:file
    vision.ts                # POST /api/read
    tts.ts                   # POST /api/speak
    cache.ts                 # web/.cache 读写
  src/
    main.ts
    feed/     ScanFeed（轮询）、ReplayFeed（回放）、从 meta 推出阶段（纯函数）
    show/     Director：状态机加每一幕的 GSAP 时间线
    scene/    renderer、moon、stars、plates、terrain、relight、post
    audio/    score（Tone.js）、quindar、voice（无线电效果链、逐词同步）
    ai/       /api 客户端、单词框映射、结果分类
    ui/       HTML 叠加层：提示、字幕、握住太阳的控件、1202 警报
    dev/      调光台
  public/assets/  moon/ stars/ fonts/ audio/
  test/       Vitest
```

### 5.3 服务端接口
- **`GET /scan/:name/:file`**
  - `name` 可以是 `latest`、`sim`，或者 `scan_\d{8}_\d{6}`。
  - `file` 只允许白名单里的文件：`meta.json`、`dir_0.png`–`dir_3.png`、`reveal.png`、`relief_raw.png`、`dark.png`。这样也就防住了路径穿越。
  - 从仓库根目录的 `out/` 读取，响应头设为 `Cache-Control: no-store`。
- **`GET /scan`**：列出 `out/` 下可以回放的文件夹，给调光台用。
- **`POST /api/read`**，请求体 `{ "scan": "latest" }`
  - 服务端自己读 `out/<scan>/reveal.png` 和 `meta.json`，浏览器不上传图片。
  - 调用 Vision `images:annotate`，参数是 `DOCUMENT_TEXT_DETECTION` 加 `languageHints: ["en"]`。
  - 返回 `{ scanId, text, words: [{ text, box: [[x,y]×4], confidence }], meanConfidence }`，坐标是 `reveal.png` 的像素坐标。`scanId` 的定义见 5.4 节。
- **`POST /api/speak`**，请求体 `{ "words": ["Meet", "me", ...] }`
  - 用 v1beta1 的 `text:synthesize`，SSML 写成 `<speak><mark name="w0"/>Meet <mark name="w1"/>me …</speak>`（单词要做 XML 转义），设置 `enableTimePointing: ["SSML_MARK"]`，输出 MP3。
  - 声音默认用 `en-US-Neural2-D`，可以配置；只能选 Neural2 这类支持 SSML 标记的声音。
  - 返回 `{ audio: base64, marks: [{ word: i, t: seconds }] }`。
- **key**：服务端通过 `loadEnv(mode, root, "")` 读取 `GOOGLE_API_KEY`，绝不加 `VITE_` 前缀，所以不会进前端包。
- **缓存**：
  - 识别结果存 `web/.cache/ocr/<cacheKey>.json`，其中 `cacheKey = <name>:<meta.started ?? "-">:<reveal.png 的 mtime>`。这是服务端专用的缓存键，和 5.4 节的 `scanId` 不是一回事；
  - 语音存 `web/.cache/tts/<sha1(voice + ssml)>.json`；
  - 重播和刷新都不会重复计费。

### 5.4 从 meta.json 推出阶段（`feed/derive.ts`，纯函数）
`scanId = meta.started ?? <name>`，用来识别是不是同一次扫描。`sim` 文件夹的 meta 没有 `started` 字段，所以它的 scanId 就是 `"sim"`。
```
status == "capturing" && captured.length < 4   → capture，activeLed = captured.length
status == "capturing" && captured.length == 4  → combining
status == "done"                               → done
scanId 变了 && status == "capturing"            → 新扫描：打断当前演出，进入第 2 幕
```
- ScanFeed 每 250 ms 读一次。JSON 解析失败或请求失败时，保持上一个状态并重试。
- 打开页面时如果看到的是 `done`，就记下它的 scanId，停在待机；按 `R` 可以重播。
- 如果拍摄阶段 120 秒没有任何变化，提示里加一句 `waiting for photo…`。不会自动放弃，按 Esc 回待机。
- 图片地址：`/scan/<name>/dir_<k>.png?v=<scanId>-<k>-<status>`。
- 事件：`scanStarted`、`ledOn(k)`、`photoLanded(k)`、`combining`、`done`。

### 5.5 ReplayFeed
- 在网址后加 `?replay=<name>`（默认是 `sim`）。它用一个已经完成的文件夹伪造时间线：每张 `pace` 秒（默认 6 秒，可以用 `&pace=` 调），合成 5 秒，然后 `done`。
- 发出的事件和 ScanFeed 完全一样。
- 用途有两个：没有硬件时开发，以及现场硬件出问题时的备用演示。

### 5.6 Director
- 阶段：`idle → capture(k) → combining → descent → reveal → hold`。
- 前三个阶段由事件推进。`done` 之后是自己计时的：降落 4 秒，日出 1.5 秒，然后朗读。
- 朗读开始前，最多等识别结果到 `done` 之后 8 秒；超时就走失败路径。
- 每一幕是一个 GSAP 时间线。按空格就 `progress(1)`，直接跳到结束状态。

### 5.7 演示机上的运行方式
- Mac 上装一次 Node（`brew install node`）。
- 之后进 `web/`，执行 `npm ci`，再执行 `npm run demo`（先 `vite build`，再 `vite preview`），打开 `http://localhost:5173` 并全屏。
- `phone.py` 另开一个终端运行。

---

## 6. 声音

- 全部用 Tone.js 实时合成，不用采样，也不用任何受版权保护的音乐。
- **乐器**：
  - pad：两个略微失谐的锯齿波，过低通滤波，起音慢；
  - 电钢琴：FM 合成，接近 Rhodes 的音色；
  - 低音：正弦波加一点泛音；
  - 噪声层：粉红噪声过带通滤波；
  - 最后统一过一个混响。
- **配乐时间线**：见第 3 节每一幕的"声音"。和弦在 `ledOn(k)` 时切换，照片落地时响一声电钢琴。
- **Quindar**：正弦波，2525 Hz 响 250 ms，放在语音之前；2475 Hz 响 250 ms，放在语音之后。
- **无线电效果链**：语音 → 高通 300 Hz → 低通 3000 Hz → 轻微失真 → 压缩 → 输出，旁边叠一层很淡的底噪，跟着传输淡入淡出。
- **压低配乐**：朗读时配乐总线降低 12 dB，恢复用 0.5 秒。
- **逐词同步**：播放时比较 `AudioContext.currentTime` 和每个标记的时间，到时间就点亮第 i 个词（画面里的框和字幕同时亮）。
- **后备方案**：TTS 不可用时，改用 `speechSynthesis`。能拿到 `onboundary` 事件就用它来同步，拿不到就按每个词的长度平均分配时间。这时没有无线电效果，但 Quindar 照播。
- **启用声音**：第一次按键时创建 AudioContext，并执行 `Tone.start()`。

---

## 7. 识别与失败处理

- **分类规则**（`ai/classify.ts`，纯函数）：
  - `ok`：至少有一个词，而且平均置信度 ≥ 0.5；
  - `weak`：一个词都没有，或者平均置信度 < 0.5；
  - `error`：网络或 HTTP 出错，或者等了 8 秒还没结果。
- **ok**：逐词朗读并高亮。字幕里的文字按 Vision 给出的顺序拼接，换行替换成空格。
- **weak 和 error**：走 1202 失败路径。
  - 画面上方弹出 `1202 PROGRAM ALARM`，琥珀色，闪两下后常亮；
  - 播放预先生成好的 `public/assets/audio/alarm-1202.mp3`（先放 Quindar，再是无线电语音："1202 alarm… we're GO. Read it with your own eyes."）；
  - 揭晓图照常放大展示，置信度 ≥ 0.5 的词照样高亮；
  - 这段音频在 Cloud TTS 可用后生成一次，存进仓库。在那之前用 `speechSynthesis` 读同一句话。
- **隐私**：识别结果只存在本机的 `web/.cache`，不进 git，调光台里可以一键清空。
- **前提**：要在 Google Cloud 项目里启用 Cloud Text-to-Speech API。如果 API key 限制了可调用的 API，还要把 TTS 加进允许列表。

---

## 8. 分层交付

> 2026-09-26 调整顺序（用户决定）：先做画面。L1 = 3D 月球、星空、照片卡片、降落与日出、握住太阳（原 L2 的重打光）。声音和 Cloud TTS 挪到下一层，纸面地形降落放在最后。

每一层做完都能完整演示。

| 层 | 内容 |
|---|---|
| **L0 骨架** | Vite+TS 项目；插件提供 `/scan` 和 `/api/read`；ScanFeed、ReplayFeed、derive、Director；HTML 叠加层（提示、字幕）；简版画面（暗背景、照片落地、揭晓图）；Vision 识别和单词框；用 `speechSynthesis` 朗读 |
| **L1 月球与声音** | 月球（贴图、月面着色、长影、地照）；真实星空；太阳跟 LED 同步；照片卡片（特写、停靠、螺旋落入）；日出揭晓和逐词高亮；后期效果和亮度上限；Tone.js 配乐；`/api/speak`、Quindar、无线电效果链；1202 路径；调光台 |
| **L2 降落与握住太阳** | 降落镜头；用真实数据生成纸面地形并算光线步进影子；月面到纸面的渐变；握住太阳的重打光和控件 |
| **L3 彩蛋** | **手写旋律**：晨昏线扫过揭晓图时，按列读取墨迹，墨迹的高度映射成音高，量化到 C 大调五声音阶，用电钢琴弹出来。**幽灵笔**：朗读时一个发光的笔尖沿字迹从左到右重写，按单词框和墨迹骨架推进 |

---

## 9. 测试

- **单元测试（Vitest）**：
  - `derive`：正常流程、演到一半来了新扫描、打开页面时停着旧的 `done`、拍摄卡住、预览图在 `done` 时被替换、JSON 解析失败；
  - `classify`：ok、weak、error 的边界；
  - SSML 生成（包括 XML 转义），以及标记对应回单词；
  - ReplayFeed 的时间线。
- **服务端测试**：模拟 `fetch` 返回的 Google 结果；测白名单和路径穿越；测缓存命中。
- **看画面**：每层都要用回放模式跑一遍 `out/sim`，再跑一遍淡的模拟扫描（`python tools/simulate.py "..." --depth 0.5`），亲眼看过才算完成。
- **彩排清单**（在 Eric 的 Mac 上接真硬件）：
  1. 完整跑一场，看帧率；
  2. 屏幕亮度对比测试：拍摄时屏幕全黑拍一次，开着我们的界面拍一次，比较两张揭晓图，再据此确定 `captureMaxLuma`；
  3. 拔掉网线跑一次，确认失败路径正常；
  4. 用外接音箱试音量。

---

## 10. 资产与许可

| 资产 | 来源 | 许可 |
|---|---|---|
| 月球颜色和高程图 | NASA SVS CGI Moon Kit | NASA 公开资料，注明出处 "NASA's Scientific Visualization Studio" |
| 星表 | Yale Bright Star Catalog（BSC5） | 公有领域 |
| Jost、JetBrains Mono | Google Fonts / JetBrains | SIL OFL 1.1 |
| three.js、Tone.js、lil-gui | npm | MIT |
| postprocessing | npm | Zlib |
| GSAP | npm | GSAP 标准许可（免费） |

`.gitignore` 要新增：`.superpowers/`、`web/node_modules/`、`web/dist/`、`web/.cache/`、`web/.env.local`。

---

## 11. Notes for Eric（需要和 Eric 确认）

These do not change the scan-folder contract.

1. **Screen ownership (not agreed yet).** Proposal: the web UI is the audience-facing show (capture → reveal → read aloud → "hold the sun"); `terminator.viewer` stays as the technical deep-dive when judges ask how it works. When the web UI owns the screen, run `python -m terminator.phone --no-show`.
2. **Audio cue clash.** `phone.py` plays `Glass.aiff` and `say <n>` at every LED. The web UI plays its own cue (a chord change and an electric-piano note) at the same moment, derived from `captured`. Proposal: add a `--quiet` flag to `phone.py` that skips `cue()`, or keep it if the presenter prefers the spoken number.
3. **Node on the demo Mac** (`brew install node`), then `cd web && npm ci && npm run demo`.
4. **Screen light during capture.** The UI caps its brightness while `status == "capturing"`; in the rehearsal we will compare a scan with the screen black against one with the UI running.
5. Keep `out/sim/` committed and complete. The UI's replay mode and all tests use it.

---

## 12. 风险

| 风险 | 缓解 |
|---|---|
| 真实揭晓图噪声大，识别不出来 | 揭晓图本身才是主要成果；1202 路径保证照样好看 |
| 性能不够 | 动态像素比，调光台里有质量档位，光线步进步数可调 |
| 贴图太大，仓库膨胀 | 颜色用 4K JPG，高程用 2K PNG，总共控制在 15 MB 以内 |
| 现场断网 | 除了 Google 全部离线；识别缓存；1202 路径 |
| 时间不够 | 分层交付，每层做完都能演示 |
| 两个窗口抢屏幕 | 第 11 节第 1 条，和 Eric 确认 |
