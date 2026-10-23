# Word 和 PDF 批量转换 Markdown

工具位于 `D:\test2\document_to_markdown`，要求 Python 3.10 或更高版本。
默认读取 `D:\test2\甲方资料`，递归转换 `.docx` 和 `.pdf`，输出到 `D:\test2\markdown_output`。
Excel、其他格式和 Office 临时锁文件不处理。旧版 `.doc` 会记录失败，需要先在 Word 中另存为 `.docx`。
源文件不修改。文件内容只作为数据解析，不执行宏、文档指令，也不访问文档里的链接。

## 最简单的运行方式

双击本目录的 **run.cmd**。

入口会创建本目录的 `.venv` 运行环境，复用所选 Python 已安装的基础依赖，缺少依赖或版本不满足要求时通过 pip 安装，然后执行批量转换。
首次安装依赖需要联网；基础转换本身在本地完成，不调用云端大模型。
入口依次查找 PATH 中的 Python、Windows py 启动器、Codex 附带的 Python。
如果检测不到你的 Python，可以在 PowerShell 中指定路径：

```powershell
cd D:\test2\document_to_markdown
.\run.ps1 -PythonPath 'C:\你的Python目录\python.exe'
```

已有本工具的 `.venv` 时会继续使用它，`-PythonPath` 只在首次创建环境时使用。
路径含空格时请保留引号。如果 PowerShell 限制脚本执行，可使用 `run.cmd`，或：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\test2\document_to_markdown\run.ps1
```

## 常用命令

```powershell
# 默认：转换整个甲方资料目录
.\run.ps1

# 只转换一个文件
.\run.ps1 -InputPath 'D:\test2\甲方资料\02_PDF合作案例\01_离散制造工厂设备联网.pdf'

# 自定义输入和输出目录
.\run.ps1 -InputPath 'D:\test2\甲方资料' -OutputPath 'D:\test2\新的转换结果'

# 强制重新生成，不使用缓存
.\run.ps1 -Force

# 保留 PDF 页眉页码
.\run.ps1 -KeepPdfHeaders -Force

# 仅安装基础依赖
.\run.ps1 -InstallOnly
```

也可使用你自己的 Python 环境，不使用启动入口：

```powershell
python -m pip install -r D:\test2\document_to_markdown\requirements.txt
python D:\test2\document_to_markdown\convert.py --input 'D:\test2\甲方资料' --output 'D:\test2\markdown_output'
```

CLI 参数：`--input`、`--output`、`--force`、`--keep-pdf-headers`、`--engine basic|docling`。
相对路径按运行命令时所在目录解析；默认路径始终相对于工具所在的 test2 目录。

## 输出结构

```text
markdown_output/
├─ 01_Word制度与培训/
│  └─ 01_公司章程与治理规则.docx/
│     ├─ document.md
│     ├─ metadata.json
│     └─ assets/                 # 有图片时生成
├─ 02_PDF合作案例/
│  └─ 01_离散制造工厂设备联网.pdf/
│     ├─ document.md
│     └─ metadata.json
└─ conversion_report.csv
```

结果目录名保留 `.docx` / `.pdf`，因此同名的 Word、PDF 不会覆盖彼此。
Markdown 使用 UTF-8；报告使用 UTF-8 BOM，可用 Excel 打开。

`metadata.json` 记录源文件绝对路径、SHA-256、工具及依赖版本、UTC 转换时间、表格图片数量、警告和输出文件哈希。
基础 PDF 模式还记录页数和页码到 Markdown 行号的映射，正文中的 `<!-- source_page: N -->` 可用于定位原页。
DOCX 不提供不可靠的页码推算。

每次运行覆盖本轮 `conversion_report.csv`。状态含义：

| 状态 | 含义 |
| --- | --- |
| success | 转换完成，未触发内置异常规则；不代表已经人工校对 |
| skipped | 源文件、工具版本、选项未变化，且上次生成文件哈希仍一致 |
| needs_review | 已生成结果，但检测到扫描页、特殊结构或其他需复核内容 |
| failed | 当前文件转换失败；其他文件继续处理 |

退出码：全部成功或跳过为 `0`；出现失败或需复核项为 `1`；参数、环境错误为 `2`。
上次为 `needs_review` 的文件再次命中缓存时显示 `skipped`，原警告仍保存在报告与元数据中。
重跑会更新生成文件，不自动清理已删除源文件的历史结果，也不删除旧图片。请不要手动修改生成目录中的同名文件。
转换失败时本次不会替换旧的成功结果；请以本轮报告状态判断其是否有效。

## 转换能力和边界

### 基础模式 basic

- Word：按正文顺序提取段落和表格，保留标题、粗体、斜体、常见列表、HTTP/HTTPS/邮件链接及段落中的内嵌图片。
- 简单表格输出 Markdown 表格；Word 合并单元格表格输出 HTML，并标记需复核。
- PDF：按文字坐标排序，用字号辅助识别标题，提取有可识别网格线的表格，合并相邻中文折行。
- PDF 顶部和底部的重复文字、边缘纯页码会被清理；可通过保留页眉参数关闭。正文中的编号和数字不会按页码规则清理。
- PDF 图片按原页区域截图导出 PNG，可能包含覆盖文字；矢量图不会自动转换为独立图片。
- 不自动做 OCR。正文文字过少的页面会标记需复核，不把扫描页作为正常成功结果。

Word 的复杂编号重启、自定义编号样式、表格内图片、文本框、内容控件、批注、脚注、公式、修订和页眉页脚不保证完整保留。
部分特殊结构会产生警告。PDF 多栏、无框表格、合并单元格、跨页表格、公式或复杂图文排版需要高级模式和人工检查。
页眉识别、标题识别、断行合并是启发式规则，请核对业务关键数字和限定条件。
基础模式不会改写、概括或推导业务内容。

### 可选高级模式 docling

```powershell
# 独立输出，便于和基础模式对比
.\run.ps1 -Engine docling -OutputPath 'D:\test2\markdown_advanced'
```

首次会安装 `requirements-advanced.txt`，依赖和模型明显大于基础模式，可能需要较长时间及较多磁盘空间。
本次交付已配置并验证基础模式，复用本机 Codex 运行时中可用的基础依赖；高级模式是可选入口，尚未在此电脑安装和实测。
Docling 可做版面识别和 OCR，但具体中文识别效果取决于版本、OCR 引擎及语言模型配置。
首次转换可能下载模型；离线机器需要先准备依赖、模型缓存和中文 OCR 配置。
高级模式保留 `structure.json` 供页码和坐标追溯，图像通过 Docling 导出；不会生成基础模式的逐页 Markdown 标记。
高级模式统一标记需复核。原文缺失或低清晰度扫描件仍需人工核对。

## 验证

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

测试覆盖正文表格顺序、缓存与输出损坏、坏文件不中断批量、输出路径保护、临时文件过滤、空白 PDF 复核、Word 合并单元格与图片、真实 PDF 表格与页码映射。
真实 PDF 测试引用 test2 内原始样例，运行测试时请保留该文件。

验收时建议逐项核对标题层级、表格行列、图片链接、金额单位、日期版本、否定条件、范围及例外条款。

参考文档：[python-docx](https://python-docx.readthedocs.io/en/latest/api/document.html)、[pdfplumber](https://github.com/jsvine/pdfplumber)、[Docling](https://docling-project.github.io/docling/)。
