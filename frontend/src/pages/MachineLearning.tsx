import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { LoadingBlock } from "@/components/ui/AsyncStates";
import { useAsyncData } from "@/hooks/useAsyncData";
import { mlApi, type ModelComparisonMetrics } from "@/services/flows";
import { Award, Terminal } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const METRIC_COLORS: Record<string, string> = {
  accuracy: "#8B5CF6",
  precision: "#EC4899",
  recall: "#22D3EE",
  f1: "#A855F7",
};

function ModelComparisonChart({ models, best }: { models: Record<string, ModelComparisonMetrics>; best: string }) {
  const data = Object.entries(models).map(([name, m]) => ({
    name: name === best ? `${name} ★` : name,
    Accuracy: m.accuracy,
    Precision: m.precision,
    Recall: m.recall,
    "F1 Score": m.f1,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "#94A3B8", fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 1]} tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: "rgba(11,15,25,0.92)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
          formatter={(v: number) => v.toFixed(3)}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Accuracy" fill={METRIC_COLORS.accuracy} radius={[4, 4, 0, 0]} />
        <Bar dataKey="Precision" fill={METRIC_COLORS.precision} radius={[4, 4, 0, 0]} />
        <Bar dataKey="Recall" fill={METRIC_COLORS.recall} radius={[4, 4, 0, 0]} />
        <Bar dataKey="F1 Score" fill={METRIC_COLORS.f1} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ConfusionMatrixHeatmap({ classes, matrix }: { classes: string[]; matrix: number[][] }) {
  const maxVal = Math.max(...matrix.flat(), 1);
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="p-1"></th>
            {classes.map((c) => (
              <th key={c} className="p-1 text-slate-500 font-medium whitespace-nowrap" style={{ writingMode: "vertical-rl" }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={classes[i]}>
              <td className="p-1 text-slate-500 font-medium text-right whitespace-nowrap pr-2">{classes[i]}</td>
              {row.map((val, j) => {
                const intensity = val / maxVal;
                const isDiagonal = i === j;
                return (
                  <td
                    key={j}
                    className="w-9 h-9 text-center rounded-md font-mono"
                    style={{
                      backgroundColor: isDiagonal
                        ? `rgba(34, 211, 238, ${0.15 + intensity * 0.55})`
                        : `rgba(236, 72, 153, ${intensity * 0.5})`,
                      color: intensity > 0.4 ? "#fff" : "#94A3B8",
                    }}
                    title={`Actual: ${classes[i]} → Predicted: ${classes[j]} = ${val}`}
                  >
                    {val > 0 ? val : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-3">
        Rows = actual class, columns = predicted class. Diagonal (cyan) = correct predictions; off-diagonal (pink) = misclassifications.
      </p>
    </div>
  );
}

export default function MachineLearning() {
  const { data: metrics, loading, error } = useAsyncData(() => mlApi.metrics(), [], "ml-metrics");

  return (
    <div>
      <PageHeader
        title="Machine Learning"
        subtitle={
          metrics
            ? `Multi-class attack classification — ${metrics.trainedOn.totalRows.toLocaleString("en-US")} real flows, ${metrics.classes.length} classes, 3 models compared`
            : "Multi-class intrusion detection, trained on real imported flows"
        }
      />

      {loading && <LoadingBlock label="Loading model metrics..." />}

      {error && (
        <GlassCard hover={false}>
          <div className="flex items-start gap-3">
            <Terminal className="w-5 h-5 text-neon-cyan shrink-0 mt-0.5" />
            <div className="text-sm text-slate-400 leading-relaxed">
              <p className="text-slate-200 font-medium mb-2">No trained model yet</p>
              <p className="mb-3">
                This page compares three real scikit-learn classifiers (Random Forest, Gradient Boosting, Logistic
                Regression) trained to predict the actual attack type — not just attack/normal — using real
                CICIDS2017 features pulled from your imported MongoDB data. Train it from a terminal:
              </p>
              <pre className="bg-black/40 border border-white/[0.06] rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">
{`cd backend
pip install -r ml/requirements.txt
python ml/train_model.py`}
              </pre>
              <p className="mt-3 text-xs text-slate-500">Then refresh this page. Training all three models can take a few minutes on large datasets.</p>
            </div>
          </div>
        </GlassCard>
      )}

      {metrics && (
        <>
          <GlassCard className="mb-5">
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-4 h-4 text-neon-cyan" />
              <p className="text-sm font-semibold text-slate-200">Model Comparison</p>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Best performer: <span className="text-neon-cyan font-medium">{metrics.bestModel}</span> (used for the
              confusion matrix and feature importance below)
            </p>
            <ModelComparisonChart models={metrics.modelsCompared} best={metrics.bestModel} />
          </GlassCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <GlassCard>
              <p className="text-sm font-semibold text-slate-200 mb-1">Confusion Matrix</p>
              <p className="text-xs text-slate-500 mb-3">{metrics.bestModel} predictions across {metrics.classes.length} attack classes (test set)</p>
              <ConfusionMatrixHeatmap classes={metrics.classes} matrix={metrics.confusionMatrix} />
            </GlassCard>

            <GlassCard delay={0.05}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Feature Importance</p>
              <p className="text-xs text-slate-500 mb-2">Real CICIDS2017 features — relative contribution to classification</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={metrics.featureImportance.slice(0, 10)} layout="vertical" margin={{ left: 40 }}>
                  <defs>
                    <linearGradient id="featureGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#8B5CF6" />
                      <stop offset="100%" stopColor="#EC4899" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="feature" type="category" tick={{ fill: "#94A3B8", fontSize: 10 }} axisLine={false} tickLine={false} width={130} />
                  <Tooltip contentStyle={{ background: "rgba(11,15,25,0.92)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="importance" fill="url(#featureGrad)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </GlassCard>
          </div>

          <p className="text-xs text-slate-500">
            Trained on {metrics.trainedOn.trainRows.toLocaleString("en-US")} rows, tested on{" "}
            {metrics.trainedOn.testRows.toLocaleString("en-US")} rows, using {metrics.trainedOn.features.length} real
            features: {metrics.trainedOn.features.join(", ")}.
            {metrics.trainedOn.droppedClasses.length > 0 && (
              <> Classes dropped for having too few samples to stratify: {metrics.trainedOn.droppedClasses.join(", ")}.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}
