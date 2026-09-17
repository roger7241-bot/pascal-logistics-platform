import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CeoHubPage } from "./pages/CeoHubPage";
import { BorderTelemetryPage } from "./pages/BorderTelemetryPage";
import { ClientPortalPage } from "./pages/ClientPortalPage";
import { OperationsQueuePage } from "./pages/OperationsQueuePage";
import { CarrierDeskPage } from "./pages/CarrierDeskPage";
import { AgentsPage } from "./pages/AgentsPage";
import { BillingAdminPage } from "./pages/BillingAdminPage";
import { ExecutiveReviewPage } from "./pages/ExecutiveReviewPage";
import { SalesLeadsPage } from "./pages/SalesLeadsPage";
import { CrmAccountsPage } from "./pages/CrmAccountsPage";
import { FacilitySopDirectoryPage } from "./pages/FacilitySopDirectoryPage";
import { DocumentVaultPage } from "./pages/DocumentVaultPage";
import { CalendarPage } from "./pages/CalendarPage";
import { ComplianceVaultPage } from "./pages/ComplianceVaultPage";
import { ClientCalendarPage } from "./pages/ClientCalendarPage";
import { ClientTier3DashboardPage } from "./pages/ClientTier3DashboardPage";
import { ClientTrackingPage } from "./pages/ClientTrackingPage";
import { ClientOnboardingPage } from "./pages/ClientOnboardingPage";
import { ClientDocumentsPage } from "./pages/ClientDocumentsPage";
import { ClientSettingsPage } from "./pages/ClientSettingsPage";
import { ClientActivityPage } from "./pages/ClientActivityPage";
import { OperatorInboxPage } from "./pages/OperatorInboxPage";
import { OperatorProspectsPage } from "./pages/OperatorProspectsPage";
import { ClientTeamPage } from "./pages/ClientTeamPage";
import { PublicLandedCostPage } from "./pages/PublicLandedCostPage";
import { ClientQuotePage } from "./pages/ClientQuotePage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { ClientDocumentGeneratorPage } from "./pages/ClientDocumentGeneratorPage";
import { ClientHtsLookupPage } from "./pages/ClientHtsLookupPage";
import { ClientCounterpartiesPage } from "./pages/ClientCounterpartiesPage";
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
          <Route path="/quote" element={<PublicLandedCostPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />

          {/* Operator-only */}
          <Route path="/" element={<RequireAuth role="operator"><CeoHubPage /></RequireAuth>} />
          <Route path="/operator" element={<RequireAuth role="operator"><CeoHubPage /></RequireAuth>} />
          <Route path="/operator/operations" element={<RequireAuth role="operator"><OperationsQueuePage /></RequireAuth>} />
          <Route path="/operator/carriers" element={<RequireAuth role="operator"><CarrierDeskPage /></RequireAuth>} />
          <Route path="/operator/agents" element={<RequireAuth role="operator"><AgentsPage /></RequireAuth>} />
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
          <Route path="/client-portal/dashboard" element={<RequireAuth><ClientTier3DashboardPage /></RequireAuth>} />
          <Route path="/client-portal/tracking" element={<RequireAuth><ClientTrackingPage /></RequireAuth>} />
          <Route path="/client-portal/onboarding" element={<RequireAuth><ClientOnboardingPage /></RequireAuth>} />
          <Route path="/client-portal/documents" element={<RequireAuth><ClientDocumentsPage /></RequireAuth>} />
          <Route path="/client-portal/settings" element={<RequireAuth><ClientSettingsPage /></RequireAuth>} />
          <Route path="/client-portal/activity" element={<RequireAuth><ClientActivityPage /></RequireAuth>} />
          <Route path="/operator/inbox" element={<RequireAuth role="operator"><OperatorInboxPage /></RequireAuth>} />
          <Route path="/operator/prospects" element={<RequireAuth role="operator"><OperatorProspectsPage /></RequireAuth>} />
          <Route path="/client-portal/team" element={<RequireAuth><ClientTeamPage /></RequireAuth>} />
          <Route path="/client-portal/quote" element={<RequireAuth><ClientQuotePage /></RequireAuth>} />
          <Route path="/client-portal/documents/generate" element={<RequireAuth><ClientDocumentGeneratorPage /></RequireAuth>} />
          <Route path="/client-portal/hts" element={<RequireAuth><ClientHtsLookupPage /></RequireAuth>} />
          <Route path="/client-portal/counterparties" element={<RequireAuth><ClientCounterpartiesPage /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
