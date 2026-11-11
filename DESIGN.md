---
name: CTRL Z
description: 既有个人页与本人互动管理列表的视觉实现记录
colors:
  paper: "#F2F2EE"
  card: "#FFFFFF"
  ink: "#141418"
  ink-2: "#53535C"
  ink-3: "#6A6B74"
  rule: "#DEDED8"
  pink: "#FF4FA7"
  blue: "#2E5BFF"
  yellow: "#FFE14A"
  orange: "#FF6B2C"
  dark-paper: "#121214"
  dark-card: "#1C1C21"
  dark-ink: "#ECECE6"
  dark-ink-2: "#B4B4BC"
  dark-ink-3: "#7D7E88"
  dark-rule: "#2B2B31"
typography:
  body:
    fontFamily: '"HarmonyOS Sans","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: "15px"
    lineHeight: 1.6
  record:
    fontFamily: '"HarmonyOS Sans","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: "16px"
    lineHeight: 1.7
  metadata:
    fontFamily: '"HarmonyOS Sans","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: "13px"
    lineHeight: 1.7
  action:
    fontFamily: '"HarmonyOS Sans","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1
  profile-tab:
    fontFamily: '"HarmonyOS Sans","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1
rounded:
  pill: "999px"
  field: "12px"
  marker: "5px 8px 6px 7px"
spacing:
  compact: "8px"
  control-gap: "12px"
  section: "18px"
  record-y: "20px"
  record-column: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "40px"
  button-light:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "40px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 14px"
    height: "44px"
  interaction-action:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 13px"
    height: "44px"
---

# Design System: CTRL Z

## Overview

**Creative North Star: "每天重印的孔版杂志"**

这是既有源码对视觉世界的命名：纸面、实色油墨、清楚的文字层级与细分隔线。个人页的管理区域沿用这套材料，以紧凑列表承载正文、来源和操作；不为本批增加新的视觉主题。

本文是实现后的有限抽样记录，覆盖共享字体与颜色、个人页页签、按钮、输入框，以及收藏与本人互动列表。事实来源为冻结前端 `D:/ctrlz/output/communication-my-interactions-20261111/frontend-e088c8fe` 的 `index.html`、`scripts/my-interactions.js`、`scripts/my-interactions.css` 与 `scripts/favorites.css`。它不是全站界面审计，也不补造缺失的产品策略。

**Key Characteristics:**

- 鸿蒙字体承担正文、导航与操作。
- 纸面与表面随主题切换，细线组织列表。
- 黄色不规则圆角色块标记个人页当前页签。
- 胶囊按钮提供直接命名的管理动作，窄屏允许动作换行。

## Colors

纸面中性色负责长时间阅读，既有粉、蓝、黄、橙油墨保留品牌与分类辨识。

### Primary

- **荧光粉**：既有强调色；本人互动列表没有新增粉色大面积表面。
- **钴蓝**：共享键盘焦点轮廓使用该色。

### Secondary

- **柠檬黄**：个人页当前页签背后的色块与文本选择色。
- **橙色油墨**：保留既有分类色，不把它改作本批删除动作的全局色。

### Neutral

- **纸面 / 卡片 / 墨色**：对应源码的 `--paper`、`--card`、`--ink`。
- **次级墨色 / 弱墨色 / 分隔线**：对应 `--ink-2`、`--ink-3`、`--rule`。正文、来源与边界各有明确层级。
- 前缀 `dark-` 的前置 token 记录深色主题值；运行时仍由同名 CSS 变量切换。手动主题与系统深色偏好均有源码支持。

**The Theme-Semantics Rule.** 本人互动分类使用主题的卡片底和墨色文字；选中项沿用墨色底、纸面字的反色组合。不要把局部修复推广为全站分段控件重绘。

## Typography

**Body Font:** HarmonyOS Sans；回退栈见前置 token。字体文件由项目本地加载。

**Display Font:** Archivo 是既有标题、海报与封面的展示字体；本批记录与操作使用正文栈，没有新增展示字角色。

正文采用舒展行距，来源文字降低尺寸与色阶。共享正文、互动原文、来源、动作和页签的实际层级见前置 token；小号动作沿用既有字号（13px），工具栏与状态说明使用（14px / 1.6–1.7）。

**The Body-For-Operations Rule.** 导航、计数、表单和管理动作继承正文栈；展示字体的既有用途不扩展到互动管理文案。

## Layout

共享容器居中，最大宽度为（1480px），水平留白使用 `--g: clamp(16px,3.2vw,44px)`。个人页保留名片、快捷入口、页签和内容区的既有顺序；页签吸附位置跟随顶栏占用高度与安全区。

互动列表每行采用正文与动作双列，正文列可收缩，动作靠右；上下内距、行列间距使用前置尺度。工具栏、动作组、状态和分页允许 flex 换行。原文保留换行，长字符串可在任意位置折行。

在（560px）及以下，记录改为单列，动作靠左；个人页页签可水平滚动且文字不折行。极窄屏（359px）及以下沿用较小的页签字号（15px）。这两类变化各自只作用于源码指定范围。

## Elevation & Depth

本批记录用表面色和底部分隔线区分层级，没有给每条记录新增投影。个人页吸附页签沿用纸面色混合透明背景与背景模糊（12px）。按钮的 inset 线是轮廓状态；主按钮悬停时使用轻量外圈。这不是全站禁止阴影或玻璃材质的规则。

共享焦点轮廓为钴蓝（2px），偏移（2px）；输入框另有墨色 inset 焦点。精确状态片段与源码已有缓动记录在侧车。

## Shapes

按钮和分段分类采用胶囊；输入框使用柔和圆角。当前个人页页签采用黄色、不规则圆角色块，最终级联已取消旋转。互动列表保持平直的细线行，不改造成独立圆角卡片。

## Components

### Buttons

主按钮为墨色底、纸面字；浅色按钮为卡片底、墨色字和细 inset 轮廓。悬停增强轮廓，按压缩放；触屏按压值由已有媒体查询调整。

共享标准按钮高度仍为（40px），小号为（32px）。本批分类、记录动作、刷新、重试、分页和确认层动作通过局部 `min-height:44px` 覆盖，不能据此声称旧站全部控件已达到该高度。未确认的操作禁用对应动作并显示状态。

### Inputs / Fields

共享单行输入使用纸面底、全宽布局与墨色 inset 焦点；移动断点内字号为（16px）。本批管理列表没有新增输入字段；该条只记录共享原语。

### Navigation

个人页使用粘性文字页签；当前项以黄色色块和深墨文字标记，数量用较小字号。源码包含 tablist / tab / tabpanel 语义、方向键和 Home / End 切换；视觉样式不代替完整键盘验收结论。

### Chips

点赞分类复用胶囊分段控件。未选中项取主题卡片底与墨色字，选中项取反色；状态同时通过 `aria-pressed` 表达。背景修正只限本人互动分类。

### Cards / Containers

既有本人评论行与新互动行都用正文、辅助来源和细底线组织内容。新行以纯文本展示可读摘要；本人评论保留自己的原文，父内容不可读时另列通用占位。读取失败、结果待确认和同条重试留在原有内容上下文中。

## Do's and Don'ts

### Do:

- **Do** 以运行时主题变量组合背景、正文和分隔线。
- **Do** 让本人互动的新动作保留至少 44px 高度，并在窄屏换行。
- **Do** 保留原文与来源的文字层级，使失败反馈靠近对应记录。

### Don't:

- **Don't** 把本批分类配色覆盖扩到全站分段控件。
- **Don't** 将已被后续级联取消的页签旋转记成当前规则。
- **Don't** 把这份有限抽样或界面 ship 处置当成全站功能、无障碍或部署验收。
