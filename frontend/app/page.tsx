"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Mail, Send, BarChart2, Shield, Zap,
  ArrowRight, CheckCircle, Globe, Users
} from "lucide-react";
import { Button } from "@/components/ui/button";

const typewriterPhrases = ["Find Blogs", "Scrape Emails", "Send Outreach", "Track Opens"];

const features = [
  {
    icon: Search,
    title: "Smart Blog Discovery",
    description: "AI-powered search finds relevant blogs in your niche using multiple query strategies.",
  },
  {
    icon: Globe,
    title: "Email Scraping",
    description: "Extracts contact emails from blog pages with rate limiting and duplicate detection.",
  },
  {
    icon: Shield,
    title: "Email Validation",
    description: "Syntax check, MX lookup, and SMTP verification to ensure deliverability.",
  },
  {
    icon: Mail,
    title: "AI-Generated Outreach",
    description: "Personalized emails written by GPT-4o-mini — one LLM call per lead, zero fluff.",
  },
  {
    icon: Send,
    title: "Bulk Sending",
    description: "Review, approve, and send emails in bulk with retry logic and exponential backoff.",
  },
  {
    icon: BarChart2,
    title: "Open Tracking",
    description: "1x1 pixel tracking tells you exactly who opened your emails and when.",
  },
];

const steps = [
  { number: "01", title: "Create a Campaign", description: "Enter your niche and launch. The AI pipeline runs automatically." },
  { number: "02", title: "Review Outreach Emails", description: "Browse AI-generated emails, edit inline, approve or reject each one." },
  { number: "03", title: "Send & Track Results", description: "Bulk send approved emails and monitor open rates in real time." },
];

export default function LandingPage() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPhraseIndex((i) => (i + 1) % typewriterPhrases.length);
        setVisible(true);
      }, 400);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-bold text-lg">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            OutreachAI
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">Login</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-block rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700 mb-6">
              AI-Powered Outreach Automation
            </span>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-gray-900 mb-6 leading-tight">
              Automate your outreach.{" "}
              <br />
              <AnimatePresence mode="wait">
                {visible && (
                  <motion.span
                    key={phraseIndex}
                    className="text-indigo-600"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.35 }}
                  >
                    {typewriterPhrases[phraseIndex]}
                  </motion.span>
                )}
              </AnimatePresence>
              {" "}at scale.
            </h1>
            <p className="mx-auto max-w-2xl text-xl text-gray-600 mb-10">
              OutreachAI finds relevant blogs, scrapes contact emails, validates them,
              writes personalized outreach, and tracks opens — fully automated.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/signup">
                <Button size="lg" className="gap-2">
                  Start for Free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline">Sign In</Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 bg-gray-50">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Everything you need</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              End-to-end outreach automation in one tool — from discovery to delivery.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                className="rounded-xl bg-white p-6 border border-gray-200 shadow-sm"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 mb-4">
                  <feature.icon className="h-5 w-5 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">How it works</h2>
            <p className="text-gray-600">Three steps from idea to inbox.</p>
          </div>
          <div className="relative">
            <div className="absolute left-8 top-10 bottom-10 w-0.5 bg-indigo-100 hidden md:block" />
            <div className="space-y-8">
              {steps.map((step, i) => (
                <motion.div
                  key={step.number}
                  className="flex gap-6 items-start"
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                >
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-sm z-10">
                    {step.number}
                  </div>
                  <div className="pt-3">
                    <h3 className="font-semibold text-gray-900 text-lg">{step.title}</h3>
                    <p className="text-gray-600 mt-1">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 bg-indigo-600">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to scale your outreach?</h2>
          <p className="text-indigo-200 mb-8">Join and start finding blogs in your niche today.</p>
          <Link href="/signup">
            <Button size="lg" className="bg-white text-indigo-600 hover:bg-indigo-50">
              Get Started Free <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-gray-100 text-center text-sm text-gray-500">
        <p>© {new Date().getFullYear()} OutreachAI. Built with FastAPI + Next.js.</p>
      </footer>
    </div>
  );
}
