# Gesture Studio：MediaPipe 手势绘画实验

一个无需构建工具的浏览器交互程序。MediaPipe Hand Landmarker 在摄像头视频中识别 21 个手部关键点；食指指尖控制画布光标，拇指与食指捏合时绘画，松开时移动。支持普通墨迹与流光笔触、颜色和粗细调整、撤销、清空、PNG 导出。没有摄像头时可以用鼠标或触控操作。

## 运行

在本目录运行：

```powershell
py -3 -m http.server 8000
```

打开 <http://localhost:8000>。浏览器需要支持 ES modules、Canvas 和摄像头 API。首次使用摄像头须允许权限，并能访问 jsDelivr 上的 MediaPipe Tasks Vision 包及 Google Storage 上的模型文件。鼠标模式可在离线环境使用。

## 方法调研

MediaPipe Tasks Vision 的 Web 用法分为四步：

1. 通过 `FilesetResolver.forVisionTasks()` 指定 WASM 运行时目录。
2. 通过 `HandLandmarker.createFromOptions()` 加载 `.task` 模型，设置 `runningMode: 'VIDEO'` 和 `numHands`。
3. 用 `getUserMedia()` 获取摄像头视频，在新视频帧上调用 `detectForVideo(video, timestamp)`。
4. 读取 `result.landmarks` 中 0 到 1 的归一化坐标。关键点 4 是拇指指尖，8 是食指指尖；本程序用二者距离除以掌宽判断捏合，使用不同的闭合与松开阈值减轻抖动。

视频预览和画布光标均做了水平镜像映射，符合自拍镜头的直觉。检测频率约为每秒 30 帧；绘画数据单独保存在归一化笔画列表中，便于缩放重绘、撤销和导出。模型在主线程同步推理，较慢设备上可能出现短暂掉帧。

参考资料：

- [MediaPipe Hand Landmarker Web Guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [MediaPipe Hand Landmarker Overview](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
- [MediaPipe Tasks Vision npm package](https://www.npmjs.com/package/@mediapipe/tasks-vision)

本环境访问官方文档时超时，上述 API 与模型路径按公开的 MediaPipe Tasks Vision Web 示例编写。实际联网运行时需确认 CDN 和模型地址可达。
