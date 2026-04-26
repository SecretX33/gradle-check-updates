import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    application
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
}

group = "com.example.core"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    api(project(":app:web:m1-data"))

    // Spring security
    implementation(libs.spring.boot.starter.security)

    // Serialization
    implementation(libs.commons.csv)
    implementation(libs.hypersistence.utils)
    implementation(libs.commons.lang3)

    // Caching
    implementation(libs.spring.session.data.redis)
    implementation(libs.spring.boot.starter.cache)
    implementation(libs.jedis)

    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.spring.boot.starter.test)
}

tasks.jar {
    enabled = true
    archiveBaseName.set("web-core")
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
