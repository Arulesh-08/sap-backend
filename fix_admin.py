content = open('routes/admin.js').read()

broken = '''router.patch("/reset-password/:userId", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { newPassword } = req.body;
      return res.status(400).json({ message: "New password must be at least 6 characters." });
    }

    const user = await User.findById(req.params.userId);

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = null;
    user.resetTokenExpires = null;
    await user.save();

    res.json({ message: `Password reset for ${user.name}.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});'''

fixed = '''router.patch("/reset-password/:userId", protect, allowRoles("admin"), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters." });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = null;
    user.resetTokenExpires = null;
    await user.save();

    res.json({ message: `Password reset for ${user.name}.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});'''

if broken not in content:
    print("PATTERN NOT FOUND — file differs from expected, paste current contents again")
else:
    open('routes/admin.js', 'w').write(content.replace(broken, fixed))
    print("fixed successfully")
