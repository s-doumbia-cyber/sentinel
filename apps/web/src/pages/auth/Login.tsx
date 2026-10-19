import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, Mail, ShieldHalf } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { GlowButton } from "@/components/ui/GlowButton";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("analyst@sentinel.io");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError("Invalid credentials. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-base-950 px-4">
      <div className="absolute inset-0 bg-grad-radial-glow" />
      <motion.div
        animate={{ opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 6, repeat: Infinity }}
        className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-neon-violet/20 blur-3xl"
      />
      <motion.div
        animate={{ opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 7, repeat: Infinity, delay: 1 }}
        className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-neon-cyan/20 blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative glass-panel w-full max-w-sm p-8"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-grad-violet-pink flex items-center justify-center shadow-glow mb-3">
            <ShieldHalf className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-display font-bold text-white">Sentinel SOC</h1>
          <p className="text-xs text-slate-500 mt-1">Sign in to your threat analysis workspace</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl py-2.5 pl-9 pr-3 text-sm text-slate-200 focus-ring focus:border-neon-violet/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl py-2.5 pl-9 pr-3 text-sm text-slate-200 focus-ring focus:border-neon-violet/50"
              />
            </div>
          </div>

          {error && <p className="text-xs text-neon-pink">{error}</p>}

          <GlowButton type="submit" disabled={loading} className="w-full justify-center">
            {loading ? "Signing in..." : "Sign in"}
          </GlowButton>
        </form>

        <p className="text-xs text-slate-500 text-center mt-6">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="text-neon-violetStrong hover:underline">
            Create one
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
