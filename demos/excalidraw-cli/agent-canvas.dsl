@direction LR
@spacing 80

@node [Agent 生成画布]
  fillStyle: solid
  backgroundColor: #dbeafe

@node [[可编辑 .excalidraw]]
  fillStyle: solid
  backgroundColor: #fef3c7

@node [客户端内置画布]
  fillStyle: solid
  backgroundColor: #dcfce7

@node {需要调整?}
  fillStyle: solid
  backgroundColor: #fce7f3

@node [拖拽、加文字、改连线]
  fillStyle: solid
  backgroundColor: #ede9fe

@node [导出 PNG / SVG]
  fillStyle: solid
  backgroundColor: #ffedd5

(开始) -> [Agent 生成画布]
[Agent 生成画布] -> "保存" -> [[可编辑 .excalidraw]]
[[可编辑 .excalidraw]] -> "打开" -> [客户端内置画布]
[客户端内置画布] -> {需要调整?}
{需要调整?} -> "是" -> [拖拽、加文字、改连线]
[拖拽、加文字、改连线] -> [客户端内置画布]
{需要调整?} -> "否" -> [导出 PNG / SVG] -> (完成)
