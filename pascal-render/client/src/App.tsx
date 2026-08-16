import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CeoHubPage } from "./pages/CeoHubPage";
import { BorderTelemetryPage } from "./pages/BorderTelemetryPage";
import { ClientPortalPage } from "./pages/ClientPortalPage";
import { OperationsQueuePage } from "./pages/OperationsQueuePage";
import { CarrierDeskPage } from "./pages/CarrierDeskPage";
import { BillingAdminPage } from "./pages/BillingAdminPage";
import { ExecutiveReviewPage } from "./pages/ExecutiveReviewPage";
import { SalesLeadsPage } from "./pages/SalesLeadsPage";
import { CrmAccountsPage } from "./pages/CrmAccountsPage";
import { FacilitySopDirectoryPage } from "./pages/FacilitySopDirectoryPage";
import { DocumentVaultPage } from "./pages/DocumentVaultPage";
import { CalendarPage } from "./pages/CalendarPage";
import { ComplianceVaultPage } from "./pages/ComplianceVaultPage";
import { ClientCalendarPage } from "./pages/ClientCalendarPage";
import { CallActivityPage } from "./pages/CallActivityPage";
import { RapidDispatchDesk } from "./pages/RapidDispatchDesk";
import { MagicUploadPage } from "./pages/MagicUploadPage";
import { PublicCargoTrackerPage } from "./pages/PublicCargoTrackerPage";
import { LoginPage } from "./pages/LoginPage";
import { RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./contexts/AuthContext";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public — no login required, matching the backend's public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/magic-upload/:token" element={<MagicUploadPage />} />
          <Route path="/track" element={<PublicCargoTrackerPage />} />
          <Route path="/track/:shipmentId" element={<PublicCargoTrackerPage />} />

          {/* Operator-only */}
          <Route path="/" element={<RequireAuth role="operator"><CeoHubPage /></RequireAuth>} />
          <Route path="/operator" element={<RequireAuth role="operator"><CeoHubPage /></RequireAuth>} />
          <Route path="/operator/operations" element={<RequireAuth role="operator"><OperationsQueuePage /></RequireAuth>} />
          <Route path="/operator/carriers" element={<RequireAuth role="operator"><CarrierDeskPage /></RequireAuth>} />
          <Route path="/operator/billing" element={<RequireAuth role="operator"><BillingAdminPage /></RequireAuth>} />
          <Route path="/operator/executive-review" element={<RequireAuth role="operator"><ExecutiveReviewPage /></RequireAuth>} />
          <Route path="/operator/leads" element={<RequireAuth role="operator"><SalesLeadsPage /></RequireAuth>} />
          <Route path="/operator/calls" element={<RequireAuth role="operator"><CallActivityPage /></RequireAuth>} />
          <Route path="/operator/crm" element={<RequireAuth role="operator"><CrmAccountsPage /></RequireAuth>} />
          <Route path="/operator/facilities" element={<RequireAuth role="operator"><FacilitySopDirectoryPage /></RequireAuth>} />
          <Route path="/operator/vault" element={<RequireAuth role="operator"><DocumentVaultPage /></RequireAuth>} />
          <Route path="/operator/calendar" element={<RequireAuth role="operator"><CalendarPage /></RequireAuth>} />
          <Route path="/operator/dispatch" element={<RequireAuth role="operator"><RapidDispatchDesk /></RequireAuth>} />

          {/* Either role — border telemetry and client portal pages are
              shared surfaces an operator can also legitimately view. */}
          <Route path="/border-telemetry" element={<RequireAuth><BorderTelemetryPage /></RequireAuth>} />
          <Route path="/client-portal" element={<RequireAuth><ClientPortalPage /></RequireAuth>} />
          <Route path="/client-portal/compliance" element={<RequireAuth><ComplianceVaultPage /></RequireAuth>} />
          <Route path="/client-portal/calendar" element={<RequireAuth><ClientCalendarPage /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
