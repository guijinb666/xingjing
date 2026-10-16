/**
 * 起境 · 你的生辰。
 *
 * 构图（taste 方向 `type-only-statement`，见 `.taste-skill/notes.md`）：
 *  - **左栏**：一行陈述「你的生辰」+ 一句支持句，然后直接是表单本身。
 *    表单**不是卡片**——它靠留白与色调差分区，不用渐变、不用毛玻璃、不用发光描边。
 *  - **右侧出血**：一圈划满刻度的黄道环，比视口大，被右边缘裁掉。
 *    它看起来像天空的一部分，而不是页面里的一张插图；右侧因此不再空白。
 *
 * 会动的那一件东西（live thing）：
 *  - 环上 360° 刻着十二宫，并标出**出生当日太阳实际所在的宫位**。
 *    换生日，太阳标记真的沿环走一格（≈30.4 天走一宫）。
 *  - 这是真实内容（日期 → 黄道经度），不是装饰；且有纯文本兜底。
 *
 * 口径声明「采用输入的当地钟表时间 · 不校正真太阳时」保留 —— 克制就是产品的性格。
 */
import { useMemo, useState } from 'react';
import type { NatalInput } from '@/domain/types';

interface Props {
  onSubmit: (input: NatalInput) => void;
  /** 已提交过的输入（用于回填与"再次编辑"） */
  value?: NatalInput | null;
}

/** 常用时区（偏移小时数），与原片"出生地时区"下拉一致 */
const TIMEZONES: { label: string; tz: string; offset: number }[] = [
  { label: '中国 · UTC+8', tz: 'Asia/Shanghai', offset: 8 },
  { label: '香港 · UTC+8', tz: 'Asia/Hong_Kong', offset: 8 },
  { label: '台北 · UTC+8', tz: 'Asia/Taipei', offset: 8 },
  { label: '东京 · UTC+9', tz: 'Asia/Tokyo', offset: 9 },
  { label: '首尔 · UTC+9', tz: 'Asia/Seoul', offset: 9 },
  { label: '新加坡 · UTC+8', tz: 'Asia/Singapore', offset: 8 },
  { label: '曼谷 · UTC+7', tz: 'Asia/Bangkok', offset: 7 },
  { label: '悉尼 · UTC+10', tz: 'Australia/Sydney', offset: 10 },
  { label: '迪拜 · UTC+4', tz: 'Asia/Dubai', offset: 4 },
  { label: '伦敦 · UTC+0', tz: 'Europe/London', offset: 0 },
  { label: '巴黎 · UTC+1', tz: 'Europe/Paris', offset: 1 },
  { label: '纽约 · UTC-5', tz: 'America/New_York', offset: -5 },
  { label: '洛杉矶 · UTC-8', tz: 'America/Los_Angeles', offset: -8 },
  { label: '温哥华 · UTC-8', tz: 'America/Vancouver', offset: -8 },
  { label: '圣保罗 · UTC-3', tz: 'America/Sao_Paulo', offset: -3 },
];

const GENDERS: ('男' | '女')[] = ['男', '女'];

/** 黄道十二宫，从白羊座（黄经 0°）起算 */
const GONG = [
  { name: '白羊', start: 0 },
  { name: '金牛', start: 30 },
  { name: '双子', start: 60 },
  { name: '巨蟹', start: 90 },
  { name: '狮子', start: 120 },
  { name: '处女', start: 150 },
  { name: '天秤', start: 180 },
  { name: '天蝎', start: 210 },
  { name: '射手', start: 240 },
  { name: '摩羯', start: 270 },
  { name: '水瓶', start: 300 },
  { name: '双鱼', start: 330 },
];

/**
 * 求某个日期太阳的黄道经度（度，0–360，白羊座起点为 0）。
 *
 * 低精度太阳位置公式（误差 ~0.01°，判"太阳在哪一宫"绰绰有余），不引入天文库。
 */
export function sunEclipticLongitude(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  return ((lambda % 360) + 360) % 360;
}

/** 黄经 → 所在的宫（宫名 / 序号 / 在宫内已走过的度数） */
export function gongOf(lon: number): { name: string; index: number; into: number } {
  const idx = Math.floor((((lon % 360) + 360) % 360) / 30);
  return { name: GONG[idx].name, index: idx, into: lon - GONG[idx].start };
}

/** 环的几何：SVG 用户坐标固定 1000×1000，交给 CSS 缩放，刻度才不被拉伸 */
const R_EXT = 470;
const R_TICK_IN = 452;
const R_TICK_MIN = 460;
const R_GONG = 424;
const R_INNER = 352;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  // 0° 在正上方，顺时针增长
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** 刻度盘：60 条短刻（一甲子）+ 12 条长刻与宫名（十二宫） */
function RingTicks() {
  const cx = 500;
  const cy = 500;
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < 60; i += 1) {
    const deg = i * 6;
    const [x1, y1] = polar(cx, cy, R_TICK_MIN, deg);
    const [x2, y2] = polar(cx, cy, R_EXT, deg);
    nodes.push(<line key={'m' + i} className="tick-minor" x1={x1} y1={y1} x2={x2} y2={y2} />);
  }

  for (let i = 0; i < 12; i += 1) {
    const deg = i * 30;
    const [x1, y1] = polar(cx, cy, R_TICK_IN, deg);
    const [x2, y2] = polar(cx, cy, R_EXT + 6, deg);
    nodes.push(<line key={'M' + i} className="tick-major" x1={x1} y1={y1} x2={x2} y2={y2} />);
    const [gx, gy] = polar(cx, cy, R_GONG, deg + 15);
    nodes.push(
      <text
        key={'g' + i}
        className="gong-label"
        x={gx}
        y={gy}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {GONG[i].name}
      </text>,
    );
  }

  return <>{nodes}</>;
}

export default function InputForm({ onSubmit, value }: Props) {
  const [date, setDate] = useState(value?.date ?? '2001-01-01');
  const [time, setTime] = useState(value?.time ?? '12:00');
  const [tzIndex, setTzIndex] = useState(() => {
    if (!value) return 0;
    const i = TIMEZONES.findIndex((z) => z.tz === value.tz);
    return i >= 0 ? i : 0;
  });
  const [gender, setGender] = useState<'男' | '女'>(value?.gender ?? '女');
  const [submitted, setSubmitted] = useState(false);

  const tz = TIMEZONES[tzIndex];
  const error = useMemo(() => {
    if (!date) return '请选择公历生日';
    if (!time) return '请选择出生时间';
    const d = new Date(`${date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '日期格式不正确';
    const y = d.getFullYear();
    if (y < 1900 || y > 2100) return '支持 1900 – 2100 年';
    return '';
  }, [date, time]);

  /** 太阳在环上的位置：换生日它就真的走一格 */
  const sun = useMemo(() => {
    const d = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      return { lon: 280.5, gong: GONG[9].name, into: 10.5, ok: false };
    }
    const lon = sunEclipticLongitude(d);
    const g = gongOf(lon);
    return { lon, gong: g.name, into: g.into, ok: true };
  }, [date]);

  const cx = 500;
  const cy = 500;
  const [sx, sy] = polar(cx, cy, R_INNER, sun.lon);
  const [hx1, hy1] = polar(cx, cy, R_INNER - 26, sun.lon);
  const [hx2, hy2] = polar(cx, cy, R_EXT + 20, sun.lon);
  // 标签贴着标记外边沿，沿径向偏 30px —— 永远跟着太阳，不会绕到环左侧压住左栏
  const [lx, ly] = polar(cx, cy, R_INNER + 30, sun.lon);

  const submit = () => {
    if (error) return;
    setSubmitted(true);
    onSubmit({ date, time, tz: tz.tz, tzOffset: tz.offset, gender });
  };

  return (
    <>
      {/* ---------- 环：从右侧出血，被视口裁切 ---------- */}
      <div className="zodiac-ring" aria-hidden>
        <svg viewBox="0 0 1000 1000">
          <defs>
            {/*
             * 纵深：从环心向外衰减到完全透明的暖光。
             * 用渐变而不是平色圆 —— 平色圆会在边缘留下一道看得见的弧，
             * 而渐变没有边界，读起来是"离环心越近越亮"，不是"这里贴了一块东西"。
             * 环心落在视口右侧偏外，所以这层亮是朝画面里侧堆积的。
             */}
            <radialGradient id="ring-depth" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(217,184,119,0.085)" />
              <stop offset="42%" stopColor="rgba(217,184,119,0.042)" />
              <stop offset="78%" stopColor="rgba(217,184,119,0.012)" />
              <stop offset="100%" stopColor="rgba(217,184,119,0)" />
            </radialGradient>
          </defs>

          <circle className="ring-depth" cx={cx} cy={cy} r={R_EXT} fill="url(#ring-depth)" />

          <circle className="ring-circle" cx={cx} cy={cy} r={R_EXT} />
          <circle className="ring-circle-inner" cx={cx} cy={cy} r={R_INNER} />
          <circle className="ring-orbit" cx={cx} cy={cy} r={R_INNER - 44} />
          <circle className="ring-orbit" cx={cx} cy={cy} r={R_INNER - 150} />
          <RingTicks />

          {/* 太阳所在宫位的指向线 */}
          <line className="sun-ray" x1={hx1} y1={hy1} x2={hx2} y2={hy2} />

          {/* 太阳标记：整页唯一一处持续呼吸的东西 */}
          <circle className="sun-halo" cx={sx} cy={sy} r={15} />
          <circle className="sun-marker" cx={sx} cy={sy} r={7} />
          <text className="sun-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="central">
            太阳
          </text>
        </svg>
      </div>

      {/* ---------- 左栏：陈述 + 表单 ---------- */}
      <div className="hero-col">
        <h1 className="hero-statement">
          <span className="line-mask">
            <span className="line-inner">你的生辰</span>
          </span>
        </h1>

        <p className="hero-support">
          给出出生的那一个瞬间。星境会把它换算成一片可以走进去的天空。
          环上标着出生当日太阳所在的宫位——它已经在那里了。
        </p>

        <div className="form-block">
          <div className="field is-full">
            <label className="field-label" htmlFor="birth-date">
              公历生日
            </label>
            <input
              id="birth-date"
              className="field-input"
              type="date"
              value={date}
              min="1900-01-01"
              max="2100-12-31"
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="birth-time">
              出生时间
            </label>
            <input
              id="birth-time"
              className="field-input"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="birth-tz">
              出生地时区
            </label>
            <div className="select-wrap">
              <select
                id="birth-tz"
                className="field-input"
                value={tzIndex}
                onChange={(e) => setTzIndex(Number(e.target.value))}
              >
                {TIMEZONES.map((z, i) => (
                  <option key={z.tz} value={i}>
                    {z.label}
                  </option>
                ))}
              </select>
              <span className="select-caret" aria-hidden>
                ⌄
              </span>
            </div>
          </div>

          <div className="field is-full">
            <span className="field-label" id="birth-gender-label">
              性别
            </span>
            <div className="gender-group" role="group" aria-labelledby="birth-gender-label">
              {GENDERS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={'gender-chip' + (gender === g ? ' is-active' : '')}
                  aria-pressed={gender === g}
                  onClick={() => setGender(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="primary-button" onClick={submit} disabled={!!error}>
            <span>{submitted ? '重新显化内景' : '开启我的星境'}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M4 12 L12 4 M6 4 H12 V10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {error && <p className="form-error">{error}</p>}

          <p className="disclaimer" data-sun-gong={sun.gong}>
            采用输入的当地钟表时间 · 不校正真太阳时。
            {sun.ok && (
              <>
                <br />
                出生日太阳行至{sun.gong}宫，已过 {sun.into.toFixed(1)}°（黄经{' '}
                {sun.lon.toFixed(1)}°）。
              </>
            )}
          </p>
        </div>

        <p className="legal-line">
          本作品为传统文化可视化呈现，命盘结果仅供文化研究与娱乐参考。
        </p>
      </div>
    </>
  );
}

export { TIMEZONES };
