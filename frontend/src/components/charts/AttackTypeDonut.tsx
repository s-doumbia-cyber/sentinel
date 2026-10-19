import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = ["#8B5CF6", "#A855F7", "#EC4899", "#F0399B", "#3B82F6", "#22D3EE", "#C084FC"];

export function AttackTypeDonut({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={65}
          outerRadius={100}
          paddingAngle={3}
          strokeWidth={0}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "rgba(11,15,25,0.92)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            fontSize: 12,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
