// ECharts 按需引入 — 只加载项目实际用到的模块，减小打包体积
import { init, use, graphic, getInstanceByDom } from 'echarts/core'
import { BarChart, LineChart, CandlestickChart, ScatterChart } from 'echarts/charts'
import {
  TooltipComponent,
  LegendComponent,
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  VisualMapComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([
  BarChart,
  LineChart,
  CandlestickChart,
  ScatterChart,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  VisualMapComponent,
  CanvasRenderer
])

export { init, graphic, getInstanceByDom }
