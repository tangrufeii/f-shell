Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$iconsDir = Join-Path $repoRoot "src-tauri\\icons"
$size = 512

function New-RoundedRectPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-SoftCircle($graphics, [float]$centerX, [float]$centerY, [float]$radius, [System.Drawing.Color]$centerColor) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($centerX - $radius, $centerY - $radius, $radius * 2, $radius * 2)
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
  $brush.CenterColor = $centerColor
  $brush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $centerColor))
  $graphics.FillEllipse($brush, $centerX - $radius, $centerY - $radius, $radius * 2, $radius * 2)
  $brush.Dispose()
  $path.Dispose()
}

function Draw-GlowLine($graphics, [float]$x1, [float]$y1, [float]$x2, [float]$y2, [float]$width, [System.Drawing.Color]$color) {
  $glowPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(84, $color.R, $color.G, $color.B)), ($width + 16)
  $glowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($glowPen, $x1, $y1, $x2, $y2)
  $glowPen.Dispose()

  $pen = New-Object System.Drawing.Pen ($color, $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($pen, $x1, $y1, $x2, $y2)
  $pen.Dispose()
}

function Draw-GlowPolyline($graphics, [System.Drawing.PointF[]]$points, [float]$width, [System.Drawing.Color]$color) {
  $glowPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(84, $color.R, $color.G, $color.B)), ($width + 16)
  $glowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($glowPen, $points)
  $glowPen.Dispose()

  $pen = New-Object System.Drawing.Pen ($color, $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($pen, $points)
  $pen.Dispose()
}

$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  [System.Drawing.PointF]::new(70, 50),
  [System.Drawing.PointF]::new(452, 470),
  [System.Drawing.Color]::FromArgb(255, 26, 38, 83),
  [System.Drawing.Color]::FromArgb(255, 20, 15, 47)
)
$backgroundBlend = New-Object System.Drawing.Drawing2D.ColorBlend
$backgroundBlend.Colors = @(
  [System.Drawing.Color]::FromArgb(255, 26, 38, 83),
  [System.Drawing.Color]::FromArgb(255, 43, 35, 93),
  [System.Drawing.Color]::FromArgb(255, 20, 15, 47)
)
$backgroundBlend.Positions = @(0.0, 0.56, 1.0)
$backgroundBrush.InterpolationColors = $backgroundBlend
$graphics.FillRectangle($backgroundBrush, 0, 0, $size, $size)

Fill-SoftCircle $graphics 110 118 118 ([System.Drawing.Color]::FromArgb(44, 114, 233, 255))
Fill-SoftCircle $graphics 408 92 92 ([System.Drawing.Color]::FromArgb(56, 255, 151, 103))
Fill-SoftCircle $graphics 426 406 104 ([System.Drawing.Color]::FromArgb(38, 85, 206, 255))

$cardPath = New-RoundedRectPath 72 58 368 368 94
$cardBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  [System.Drawing.PointF]::new(88, 62),
  [System.Drawing.PointF]::new(430, 420),
  [System.Drawing.Color]::FromArgb(255, 28, 39, 86),
  [System.Drawing.Color]::FromArgb(255, 18, 13, 42)
)
$cardBlend = New-Object System.Drawing.Drawing2D.ColorBlend
$cardBlend.Colors = @(
  [System.Drawing.Color]::FromArgb(255, 28, 39, 86),
  [System.Drawing.Color]::FromArgb(255, 39, 33, 86),
  [System.Drawing.Color]::FromArgb(255, 18, 13, 42)
)
$cardBlend.Positions = @(0.0, 0.55, 1.0)
$cardBrush.InterpolationColors = $cardBlend
$graphics.FillPath($cardBrush, $cardPath)

$framePath = New-RoundedRectPath 84 70 344 344 82
$frameBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  [System.Drawing.PointF]::new(90, 74),
  [System.Drawing.PointF]::new(430, 412),
  [System.Drawing.Color]::FromArgb(210, 152, 248, 255),
  [System.Drawing.Color]::FromArgb(190, 255, 186, 122)
)
$framePen = New-Object System.Drawing.Pen $frameBrush, 7
$graphics.DrawPath($framePen, $framePath)

$glassPath = New-RoundedRectPath 106 102 300 270 64
$glassBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  [System.Drawing.PointF]::new(120, 110),
  [System.Drawing.PointF]::new(386, 354),
  [System.Drawing.Color]::FromArgb(232, 37, 53, 112),
  [System.Drawing.Color]::FromArgb(248, 25, 21, 61)
)
$graphics.FillPath($glassBrush, $glassPath)

$topBarPath = New-RoundedRectPath 130 130 252 32 16
$topBarBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(20, 255, 255, 255))
$graphics.FillPath($topBarBrush, $topBarPath)

$topDots = @(
  @{ X = 157; Color = [System.Drawing.Color]::FromArgb(255, 126, 246, 255) },
  @{ X = 175; Color = [System.Drawing.Color]::FromArgb(255, 162, 177, 255) },
  @{ X = 193; Color = [System.Drawing.Color]::FromArgb(255, 255, 192, 127) }
)
foreach ($dot in $topDots) {
  $dotBrush = New-Object System.Drawing.SolidBrush $dot.Color
  $graphics.FillEllipse($dotBrush, $dot.X, 140, 10, 10)
  $dotBrush.Dispose()
}

$sidebarPath = New-RoundedRectPath 138 184 54 156 20
$sidebarBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(18, 255, 255, 255))
$graphics.FillPath($sidebarBrush, $sidebarPath)

$sidebarRows = @(
  @{ Y = 208; Alpha = 235; Color = [System.Drawing.Color]::FromArgb(255, 139, 223, 255) },
  @{ Y = 230; Alpha = 150; Color = [System.Drawing.Color]::FromArgb(255, 255, 255, 255) },
  @{ Y = 252; Alpha = 110; Color = [System.Drawing.Color]::FromArgb(255, 255, 255, 255) },
  @{ Y = 274; Alpha = 78; Color = [System.Drawing.Color]::FromArgb(255, 255, 255, 255) }
)
foreach ($row in $sidebarRows) {
  $rowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($row.Alpha, $row.Color.R, $row.Color.G, $row.Color.B))
  $rowPath = New-RoundedRectPath 152 $row.Y 28 9 4
  $graphics.FillPath($rowBrush, $rowPath)
  $rowBrush.Dispose()
  $rowPath.Dispose()
}

$accent = [System.Drawing.Color]::FromArgb(255, 245, 248, 255)
$promptPoints = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(228, 220),
  [System.Drawing.PointF]::new(286, 262),
  [System.Drawing.PointF]::new(228, 304)
)
Draw-GlowPolyline $graphics $promptPoints 20 $accent
Draw-GlowLine $graphics 314 322 356 322 20 $accent

$tailPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$tailPath.AddBezier(142, 376, 182, 348, 226, 336, 274, 336)
$tailPath.AddLine(274, 336, 392, 336)
$tailPath.AddLine(392, 336, 392, 354)
$tailPath.AddLine(392, 354, 280, 354)
$tailPath.AddBezier(280, 354, 224, 354, 184, 370, 160, 406)
$tailPath.AddLine(160, 406, 142, 376)
$tailBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(236, 255, 180, 107))
$graphics.FillPath($tailBrush, $tailPath)

$shinePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(34, 255, 255, 255)), 5
$shinePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$shinePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($shinePen, 108, 94, 236, 166, 198, 78)

$png256 = Join-Path $iconsDir "icon-256.png"
$png128 = Join-Path $iconsDir "icon-128.png"
$png32 = Join-Path $iconsDir "icon-32.png"
$png512 = Join-Path $iconsDir "icon.png"

$bitmap.Save($png512, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Save($png256, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap128 = New-Object System.Drawing.Bitmap $bitmap, 128, 128
$bitmap128.Save($png128, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap32 = New-Object System.Drawing.Bitmap $bitmap, 32, 32
$bitmap32.Save($png32, [System.Drawing.Imaging.ImageFormat]::Png)

$bitmap256 = New-Object System.Drawing.Bitmap $bitmap, 256, 256
$iconHandle = $bitmap256.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$iconStream = [System.IO.File]::Create((Join-Path $iconsDir "icon.ico"))
$icon.Save($iconStream)
$iconStream.Close()

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class IconApi {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern bool DestroyIcon(IntPtr handle);
}
"@
[IconApi]::DestroyIcon($iconHandle) | Out-Null

$icon.Dispose()
$bitmap256.Dispose()
$bitmap128.Dispose()
$bitmap32.Dispose()
$shinePen.Dispose()
$tailBrush.Dispose()
$tailPath.Dispose()
$sidebarBrush.Dispose()
$sidebarPath.Dispose()
$topBarBrush.Dispose()
$topBarPath.Dispose()
$glassBrush.Dispose()
$glassPath.Dispose()
$framePen.Dispose()
$frameBrush.Dispose()
$framePath.Dispose()
$cardBrush.Dispose()
$cardPath.Dispose()
$backgroundBrush.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Icons generated in $iconsDir"
