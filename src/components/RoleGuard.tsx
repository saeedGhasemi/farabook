import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRoles, type AppRole } from "@/hooks/useRoles";
import { Loader2 } from "lucide-react";

interface RoleGuardProps {
  roles: AppRole[];
  children: ReactNode;
  fallback?: ReactNode;
  redirectTo?: string;
}

export const RoleGuard = ({ roles, children, fallback, redirectTo }: RoleGuardProps) => {
  const { user, loading: authLoading } = useAuth();
  const { roles: userRoles, loading } = useRoles();

  if (authLoading || loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return redirectTo ? <Navigate to={redirectTo} replace /> : <>{fallback}</>;

  const ok = roles.some((r) => userRoles.includes(r));
  if (!ok) {
    if (redirectTo) return <Navigate to={redirectTo} replace />;
    return (
      <>
        {fallback ?? (
          <div className="container py-20 text-center">
            <h2 className="text-2xl font-display font-bold mb-2">دسترسی غیرمجاز</h2>
            <p className="text-muted-foreground">شما اجازه دسترسی به این بخش را ندارید.</p>
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
};
