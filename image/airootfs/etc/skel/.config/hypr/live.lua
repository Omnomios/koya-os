hl.window_rule({
  name = "float-koya-installer",
  match = { class = "^(koya-installer)$" },
  float = true,
})

hl.on("hyprland.start", function()
  hl.exec_cmd("/usr/local/bin/koya-installer")
end)
