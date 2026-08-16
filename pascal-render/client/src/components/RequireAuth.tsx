import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

interface RequireAuthProps {
  children: React.ReactNode;
  role?: "operator" | "client"; // when omitted, either role can access
}

export function RequireAuth({ children, role }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (role && user.role !== role) return <Navigate to={user.role === "operator" ? "/operator" : "/client-portal"} replace />;

  return <>{children}</>;
}
