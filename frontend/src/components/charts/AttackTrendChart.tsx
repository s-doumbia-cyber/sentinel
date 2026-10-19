import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Props {
  data: { date: string; attacks: number; normal: number }[];
}

export function AttackTrendChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="attacksGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EC4899" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#EC4899" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="normalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: "rgba(11,15,25,0.92)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            fontSize: 12,
            backdropFilter: "blur(12px)",
          }}
          labelStyle={{ color: "#E2E8F0" }}
        />
        <Area type="monotone" dataKey="attacks" stroke="#EC4899" strokeWidth={2} fill="url(#attacksGrad)" name="Attacks" />
        <Area type="monotone" dataKey="normal" stroke="#22D3EE" strokeWidth={2} fill="url(#normalGrad)" name="Normal" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
