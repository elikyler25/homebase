import os, subprocess, tempfile, unittest
import discover


def _write(path, text):
    with open(path, "w") as f:
        f.write(text)


class T(unittest.TestCase):
    def _mk(self, tmp, name):
        p = os.path.join(tmp, name)
        os.makedirs(p)
        return p

    def test_classify_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "repo")
            subprocess.run(["git", "-C", p, "init", "-q"])
            self.assertEqual(discover.classify(p), "git")

    def test_classify_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "bundle")
            _write(os.path.join(p, "START-HERE.md"), "# Hi\n")
            self.assertEqual(discover.classify(p), "bundle")

    def test_classify_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "plain")
            _write(os.path.join(p, "notes.txt"), "x")
            self.assertIsNone(discover.classify(p))

    def test_status_summary_state_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "proj")
            _write(os.path.join(p, "STATE.md"),
                   "# S\n\n**Last updated:** 2026-07-24 — slider fit underway\n")
            s = discover.status_summary(p)
            self.assertIn("2026-07-24", s)
            self.assertNotIn("**", s)  # markdown bold stripped

    def test_status_summary_prefers_md_over_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "bundle")
            _write(os.path.join(p, "START-HERE.html"), "<!DOCTYPE html>\n<h1>nope</h1>\n")
            _write(os.path.join(p, "00-START-HERE-GUIDE.md"), "# Real Title Here\n")
            self.assertEqual(discover.status_summary(p), "Real Title Here")

    def test_enrich_registered_unmarked_dir_is_dir_not_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "webproj")
            _write(os.path.join(p, "README.md"), "# Web Project\n")  # README is not a marker
            rec = discover.enrich([{"name": "web", "path": p}])[0]
            self.assertEqual(rec["type"], "dir")
            missing = discover.enrich([{"name": "x", "path": "/no/such/path/xyz"}])[0]
            self.assertEqual(missing["type"], "missing")

    def test_project_root_resolves_git_toplevel(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "repo")
            subprocess.run(["git", "-C", p, "init", "-q"])
            sub = self._mk(p, "src")
            self.assertEqual(os.path.realpath(discover._project_root(sub)),
                             os.path.realpath(p))

    def test_project_root_none_for_plain_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "plain")  # not git, no marker
            self.assertIsNone(discover._project_root(p))

    def test_scan_account_reads_cwd_from_transcript(self):
        with tempfile.TemporaryDirectory() as tmp:
            # a fake real project (git), and a fake ~/.claude/projects dir with a transcript
            proj = self._mk(tmp, "realproj")
            subprocess.run(["git", "-C", proj, "init", "-q"])
            pdir = self._mk(tmp, "projects")
            enc = self._mk(pdir, "-enc-realproj")
            _write(os.path.join(enc, "session.jsonl"),
                   '{"cwd": "%s"}\n{"type":"other"}\n' % proj)
            found = {os.path.realpath(x) for x in discover.scan_account(projects_dir=pdir)}
            self.assertIn(os.path.realpath(proj), found)

    def test_scan_new_finds_unregistered(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self._mk(tmp, "newproj")
            subprocess.run(["git", "-C", p, "init", "-q"])
            found = discover.scan_new(set(), roots=[tmp])
            self.assertIn(os.path.realpath(p), {os.path.realpath(x) for x in found})

    def test_scan_new_excludes_roots_themselves(self):
        with tempfile.TemporaryDirectory() as tmp:
            outer = self._mk(tmp, "outer")   # both a scan-root and a child of tmp
            _write(os.path.join(outer, "START-HERE.md"), "# marker\n")
            found = {os.path.realpath(x) for x in discover.scan_new(set(), roots=[tmp, outer])}
            self.assertNotIn(os.path.realpath(outer), found)

    def test_scan_new_prunes_children_of_known(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = self._mk(tmp, "registered")
            subprocess.run(["git", "-C", parent, "init", "-q"])
            child = self._mk(parent, "docs")          # a marker-bearing subfolder
            _write(os.path.join(child, "SPEC.md"), "# spec\n")
            found = {os.path.realpath(x) for x in discover.scan_new({parent}, roots=[tmp])}
            self.assertNotIn(os.path.realpath(child), found)


if __name__ == "__main__":
    unittest.main()
