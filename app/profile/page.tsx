"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    subjectName: "",
    dominantName: "",
    dominantTitle: "Master",
  });

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/signin");
      return;
    }

    // Load user data
    setFormData((prev) => ({
      ...prev,
      name: session.user?.name || "",
    }));
  }, [session, status, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setMessage("Profile updated successfully!");
      } else {
        const data = await response.json();
        setMessage(data.error || "Failed to update profile");
      }
    } catch {
      setMessage("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Profile Settings</h1>

          {message && (
            <div
              className={`mb-6 p-4 rounded ${
                message.includes("success")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-4">Account</h2>
              <div className="space-y-4">
                <Input
                  id="email"
                  type="email"
                  label="Email"
                  value={session?.user?.email || ""}
                  disabled
                  className="bg-gray-50"
                />
                <Input
                  id="name"
                  name="name"
                  type="text"
                  label="Display Name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Your name"
                />
              </div>
            </div>

            <hr className="border-gray-200" />

            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-4">Session Preferences</h2>
              <p className="text-sm text-gray-600 mb-4">
                These names will be used in personalized mantras during sessions.
              </p>
              <div className="space-y-4">
                <Input
                  id="subjectName"
                  name="subjectName"
                  type="text"
                  label="Your Name (in mantras)"
                  value={formData.subjectName}
                  onChange={handleChange}
                  placeholder="e.g., pet, sweetie, good girl..."
                />
                <Input
                  id="dominantName"
                  name="dominantName"
                  type="text"
                  label="Dominant's Name"
                  value={formData.dominantName}
                  onChange={handleChange}
                  placeholder="e.g., Master, Mistress, Sir..."
                />
                <div>
                  <label
                    htmlFor="dominantTitle"
                    className="block text-sm font-medium text-gray-900 mb-1"
                  >
                    Dominant Title
                  </label>
                  <select
                    id="dominantTitle"
                    name="dominantTitle"
                    value={formData.dominantTitle}
                    onChange={handleChange}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                  >
                    <option value="Master">Master</option>
                    <option value="Mistress">Mistress</option>
                    <option value="Sir">Sir</option>
                    <option value="Ma'am">Ma&apos;am</option>
                    <option value="Daddy">Daddy</option>
                    <option value="Mommy">Mommy</option>
                    <option value="Owner">Owner</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-pink-600 text-white py-3 px-4 rounded-lg hover:bg-pink-700 disabled:opacity-50 font-medium"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
