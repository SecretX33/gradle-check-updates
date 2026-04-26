import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

group = "com.example.supply.spi"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    implementation(project(":app:common"))
    implementation(project(":app:supply:m1-data"))
    implementation(project(":app:supply:m2-services"))
    implementation(project(":app:content:m5-api"))

    implementation(libs.kotlinx.coroutines.core)

    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.webflux)
    implementation(libs.commons.lang3)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.mockk)
    testImplementation(libs.springmockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.assertj.core)
    testImplementation(libs.reactor.test)
}

tasks.jar {
    enabled = true
    archiveBaseName.set("supply-api")
    archiveClassifier.set("")

    // Optimize Jar creation
    duplicatesStrategy = DuplicatesStrategy.WARN

    // Enable caching for Jar tasks
    outputs.cacheIf { true }
}

tasks.bootJar {
    enabled = false
}

// Optimize build cache for this module
tasks.withType<JavaCompile>().configureEach {
    options.isFork = true
    options.isIncremental = true

    // Enable caching for Java compilation
    outputs.cacheIf { true }
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }

    // Enable caching for Kotlin compilation
    outputs.cacheIf { true }
}
