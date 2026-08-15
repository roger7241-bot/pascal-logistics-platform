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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CeoHubPage />} />
        <Route path="/operator" element={<CeoHubPage />} />
        <Route path="/operator/operations" element={<OperationsQueuePage />} />
        <Route path="/operator/carriers" element={<CarrierDeskPage />} />
        <Route path="/operator/billing" element={<BillingAdminPage />} />
        <Route path="/operator/executive-review" element={<ExecutiveReviewPage />} />
        <Route path="/operator/leads" element={<SalesLeadsPage />} />
        <Route path="/operator/calls" element={<CallActivityPage />} />
        <Route path="/operator/crm" element={<CrmAccountsPage />} />
        <Route path="/operator/facilities" element={<FacilitySopDirectoryPage />} />
        <Route path="/operator/vault" element={<DocumentVaultPage />} />
        <Route path="/operator/calendar" element={<CalendarPage />} />
        <Route path="/operator/dispatch" element={<RapidDispatchDesk />} />
        <Route path="/magic-upload/:token" element={<MagicUploadPage />} />
        <Route path="/track" element={<PublicCargoTrackerPage />} />
        <Route path="/track/:shipmentId" element={<PublicCargoTrackerPage />} />
        <Route path="/border-telemetry" element={<BorderTelemetryPage />} />
        <Route path="/client-portal" element={<ClientPortalPage />} />
        <Route path="/client-portal/compliance" element={<ComplianceVaultPage />} />
        <Route path="/client-portal/calendar" element={<ClientCalendarPage />} />
      </Routes>
    </BrowserRouter>
  );
}
