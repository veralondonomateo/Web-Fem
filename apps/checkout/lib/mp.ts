export type DBPaymentStatus = "pending" | "approved" | "failure" | "in_process";

export function mapMPStatus(mpStatus: string): DBPaymentStatus {
  switch (mpStatus) {
    case "approved":
      return "approved";
    case "rejected":
    case "cancelled":
      return "failure";
    case "in_process":
    case "authorized":
      return "in_process";
    default:
      return "pending";
  }
}
