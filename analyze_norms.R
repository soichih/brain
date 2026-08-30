## Generates data/brain-norms.js: percentile positions for my FreeSurfer measures
## against the lifespan brain-charts normative models (Bethlehem et al. 2022, Nature).
##
## Usage (Docker, matching the run that produced the committed data file):
##   docker build -t fs-norms-r - <<'EOF'
##   FROM rocker/r-base:4.4.1
##   RUN Rscript -e "install.packages(c('gamlss','jsonlite'), repos='https://cloud.r-project.org')"
##   EOF
##   git clone https://github.com/brainchart/lifespan $HOME/lifespan
##   docker run --rm -v $HOME:/repo fs-norms-r Rscript /repo/brain/analyze_norms.R
## (the script expects the lifespan repo at /repo/lifespan and writes /repo/brain-norms.js;
##  user values below are from FreeSurfer 8.2.0 recon-all stats — update them to re-run)

REPO <- "/repo/lifespan"; setwd(REPO)
for (f in c("100.common-variables.r","101.common-functions.r","102.gamlss-recode.r",
            "300.variables.r","301.functions.r"))
  suppressWarnings(suppressMessages(source(file.path(REPO, f))))

library(jsonlite)

## ---- user values (from FreeSurfer 8.2.0, mm3) ----
USER <- list(
  eTIV       = 1681088.9,
  GMV        = 480846.4,    ## CortexVol
  WMV        = 499310.0,    ## CerebralWhiteMatterVol
  sGMV       = (7098.5+7479.8)+(4009.0+4117.0)+(5779.7+5592.0)+(1785.4+1689.4)+
               (4422.3+4991.9)+(2077.7+2266.7)+(628.8+706.5)+(4325.9+4305.2),
  Ventricles = 19891.0,
  TCV        = 480846.4 + 499310.0,   ## GMV+WMV (cerebrum total cortical volume)
  meanCT     = (2.45422+2.35981)/2,  ## mean of lh/rh MeanThickness (mm)
  totalSA    = 91653.9 + 92095.2,
  ## subcortical L+R totals, mm3
  Thalamus.Proper  = 7098.5+7479.8,
  Caudate          = 4009.0+4117.0,
  Putamen          = 5779.7+5592.0,
  Pallidum         = 1785.4+1689.4,
  Hippocampus      = 4422.3+4991.9,
  Amygdala         = 2077.7+2266.7,
  Accumbens.area   = 628.8+706.5,
  VentralDC        = 4325.9+4305.2
)
## real totalSA from lh+rh white-surface areas (mm2)


## ---- helpers ----
AGE_DAYS <- 365 * 48
newgrid <- function(extra = list()) {
  g <- do.call(expand.grid, c(list(AgeTransformed = log(AGE_DAYS),
                                   sex = factor("Male", levels = c("Female","Male"))), extra))
  g
}

## percentile of user's value vs. population (no study ranef, fs_version at grand mean)
pct.of <- function(fitfile, value) {
  FIT <- readRDS(file.path(REPO, "Share", "RefittedModels", fitfile))
  cov <- attr(FIT$param, "model")$covariates
  Y <- cov$Y
  G <- newgrid()
  G[[Y]] <- value
  R <- Apply.Param(NEWData = G, FITParam = FIT$param, Add.Normalise = TRUE,
                   Add.Derivative = FALSE)
  ## the centile column is named after the response column, which some fits
  ## store as "<Y>" and others as "<Y>Transformed"
  qcol <- sprintf("%s.q.pop", Y)
  if (is.null(R[[qcol]])) qcol <- sprintf("%sTransformed.q.pop", Y)
  list(median  = R[[sprintf("PRED.m500.pop")]][1],
       pct     = R[[qcol]][1],
       params  = list(mu = R[["mu.pop"]][1], sigma = R[["sigma.pop"]][1]))
}

curves.of <- function(fitfile, ages = seq(20, 80, by = 1)) {
  FIT <- readRDS(file.path(REPO, "Share", "RefittedModels", fitfile))
  G <- do.call(expand.grid, list(AgeTransformed = log(365 * ages),
                                 sex = factor("Male", levels = c("Female","Male"))))
  R <- Apply.Param(NEWData = G, FITParam = FIT$param, Add.Derivative = FALSE)
  list(ages = ages,
       lo   = R$PRED.l025.pop, lin = R$PRED.l250.pop, med = R$PRED.m500.pop,
       hiin = R$PRED.u750.pop, hi  = R$PRED.u975.pop)
}

OUT <- list(meta = list(age = 48, sex = "male", family = "GGalt",
             source = "Bethlehem et al. 2022 Nature brain-charts (FS-harmonized to FS6)"),
       composition = list(), global = list(), subcortical = list())

CONV <- function(mm3) mm3 / 1e4   ## mm3 -> model unit (1e-2 L); cm3 = model*10

## ---- composition panels (curves scaled to cm3 = model*10) ----
for (n in c("GMV","WMV","sGMV","Ventricles")) {
  f <- sprintf("FIT_%s.rds", n)
  cv <- curves.of(f)
  cv$lo <- round(cv$lo * 10, 2); cv$lin <- round(cv$lin * 10, 2)
  cv$med <- round(cv$med * 10, 2); cv$hiin <- round(cv$hiin * 10, 2)
  cv$hi <- round(cv$hi * 10, 2)
  p  <- pct.of(f, CONV(USER[[n]]))
  OUT$composition[[n]] <- c(list(user = round(USER[[n]]/1000, 1),
                                 pct = p$pct * 100),
                            cv,
                            median = round(p$median * 10, 1))
  cat(n, " pct:", round(p$pct*100,1), " median_cm3:", round(p$median*10,1),
      " mu:", p$params$mu, "\n")
}

## ---- globals (percentile only) ----
GLOBAL_FILES <- list(eTIV="FIT_eTIVTransformed.gz", TCV="FIT_TCV.rds",
                     meanCT="FIT_meanCT2.rds", totalSA="FIT_totalSA2.rds")
for (key in names(GLOBAL_FILES)) {
  f <- GLOBAL_FILES[[key]]
  val <- if (key == "meanCT") USER$meanCT else if (key == "totalSA") USER$totalSA else USER[[key]]
  v <- val / 10000
  p <- pct.of(f, v)
  OUT$global[[key]] <- list(user = if (grepl("meanCT|totalSA", key)) round(val,2) else round(USER[[key]]/1000, 1),
                            pct = p$pct * 100, median = p$median, param = p$params)
  cat(key, " pct:", round(p$pct*100,1), " median:", p$median, "\n")
}

## ---- subcortical: models are per-hemisphere (each side an observation),
## so percentiles are computed per side against the single-side distribution ----
SIDES <- list(
  list(fs = "Thalamus.Proper",  key = "Thalamus",      lh = 7098.5, rh = 7479.8),
  list(fs = "Caudate",          key = "Caudate",       lh = 4009.0, rh = 4117.0),
  list(fs = "Putamen",          key = "Putamen",       lh = 5779.7, rh = 5592.0),
  list(fs = "Pallidum",         key = "Pallidum",      lh = 1785.4, rh = 1689.4),
  list(fs = "Hippocampus",      key = "Hippocampus",   lh = 4422.3, rh = 4991.9),
  list(fs = "Amygdala",         key = "Amygdala",      lh = 2077.7, rh = 2266.7),
  list(fs = "Accumbens.area",   key = "Accumbens area",lh = 628.8,  rh = 706.5),
  list(fs = "VentralDC",        key = "VentralDC",     lh = 4325.9, rh = 4305.2)
)
for (s in SIDES) {
  f <- sprintf("FIT_%sTransformed.gz", s$fs)
  pl <- tryCatch(pct.of(f, s$lh / 10000), error = function(e) { cat(s$key, "L ERR:", conditionMessage(e), "\n"); NULL })
  pr <- tryCatch(pct.of(f, s$rh / 10000), error = function(e) { cat(s$key, "R ERR:", conditionMessage(e), "\n"); NULL })
  if (!is.null(pl) && !is.null(pr)) {
    cv <- curves.of(f)
    cv$lo   <- round(cv$lo   * 10, 2)  # model unit -> cm3
    cv$lin  <- round(cv$lin  * 10, 2)
    cv$med  <- round(cv$med  * 10, 2)
    cv$hiin <- round(cv$hiin * 10, 2)
    cv$hi   <- round(cv$hi   * 10, 2)
    OUT$subcortical[[s$key]] <- c(list(
      l = list(user = round(s$lh/1000, 2), pct = pl$pct * 100),
      r = list(user = round(s$rh/1000, 2), pct = pr$pct * 100),
      median = round(pl$median * 10, 2)),  # per-hemisphere median, cm3
      cv)
    cat(s$key, " L:", round(pl$pct*100,1), " R:", round(pr$pct*100,1),
        " median_side_cm3:", round(pl$median*10,2), "\n")
  }
}

## ---- cortex: per-region mean thickness (Desikan atlas, 34 regions).
## models may be in raw mm or model-unit mm/1e4 — detect the scale from the
## population median (must land in 1.2–4 mm either way) ----
CORTEX_VALS <- list(   ## lh, rh ThickAvg (mm) from lh/rh.aparc.stats
  bankssts                = c(2.375, 2.567),
  caudalanteriorcingulate = c(2.724, 2.327),
  caudalmiddlefrontal     = c(2.402, 2.370),
  cuneus                  = c(1.883, 1.876),
  entorhinal              = c(2.812, 2.918),
  fusiform                = c(2.679, 2.739),
  inferiorparietal        = c(2.362, 2.386),
  inferiortemporal        = c(2.773, 2.747),
  isthmuscingulate        = c(2.344, 2.040),
  lateraloccipital        = c(2.209, 2.250),
  lateralorbitofrontal    = c(2.592, 2.285),
  lingual                 = c(1.923, 1.918),
  medialorbitofrontal     = c(2.372, 2.285),
  middletemporal          = c(2.850, 2.809),
  parahippocampal         = c(2.657, 2.542),
  paracentral             = c(2.353, 2.403),
  parsopercularis         = c(2.715, 2.531),
  parsorbitalis           = c(2.596, 2.361),
  parstriangularis        = c(2.562, 2.238),
  pericalcarine           = c(1.510, 1.450),
  postcentral             = c(2.115, 1.994),
  posteriorcingulate      = c(2.536, 2.423),
  precentral              = c(2.545, 2.431),
  precuneus               = c(2.389, 2.367),
  rostralanteriorcingulate= c(3.011, 2.526),
  rostralmiddlefrontal    = c(2.317, 2.057),
  superiorfrontal         = c(2.585, 2.442),
  superiorparietal        = c(2.085, 2.047),
  superiortemporal        = c(2.887, 2.800),
  supramarginal           = c(2.345, 2.338),
  frontalpole             = c(2.425, 2.001),
  temporalpole            = c(3.469, 3.121),
  transversetemporal      = c(2.360, 2.641),
  insula                  = c(2.961, 2.731)
)
for (key in names(CORTEX_VALS)) {
  f <- sprintf("FIT_CT_%s.rds", key)
  res <- tryCatch({
    cv <- curves.of(f)
    med0 <- cv$med[1]
    scale <- if (med0 * 10000 > 1.2 && med0 * 10000 < 4) 10000 else 1
    ## keep only the population band at age 48 (i48 = index of 48 in seq(20,80))
    i48 <- 48 - 20 + 1
    pl <- pct.of(f, CORTEX_VALS[[key]][1] / scale)
    pr <- pct.of(f, CORTEX_VALS[[key]][2] / scale)
    list(l  = list(user = CORTEX_VALS[[key]][1], pct = pl$pct * 100),
         r  = list(user = CORTEX_VALS[[key]][2], pct = pr$pct * 100),
         median = round(pl$median * scale, 3),
         lo   = round(cv$lo[i48]   * scale, 3),
         lin  = round(cv$lin[i48]  * scale, 3),
         hiin = round(cv$hiin[i48] * scale, 3),
         hi   = round(cv$hi[i48]   * scale, 3))
  }, error = function(e) { cat(key, "ERR:", conditionMessage(e), "\n"); NULL })
  if (!is.null(res)) {
    OUT$cortex[[key]] <- res
    cat(key, " L:", round(res[["l"]][["pct"]], 1), " R:", round(res[["r"]][["pct"]], 1),
        " median_mm:", res$median, "\n")
  }
}

write_lines <- function(x, path) cat(x, "\n", file = path, sep = "")
js <- capture.output(cat("window.BRAIN_NORMS = ", toJSON(OUT, auto_unbox = TRUE, digits = 6), ";", sep = ""))
writeLines(js, "/repo/brain-norms.js")
cat("WROTE /repo/brain-norms.js\n")